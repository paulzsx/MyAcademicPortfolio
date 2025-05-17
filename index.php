<?php
require_once 'db_connect.php';
header('Content-Type: application/json');
$action = $_REQUEST['action'] ?? 'unknown';
$response = ['success' => false, 'message' => 'Invalid action specified.'];
$isWriteOperation = ($_SERVER['REQUEST_METHOD'] === 'POST');

if ($isWriteOperation) {
    mysqli_begin_transaction($conn); // Start transaction only needed for writes
}

try { // Use try-catch for better error management

    switch ($action) {
        // --- GET ACTIONS ---
        case 'get_bins':
            $sql = "SELECT id, bin_identifier, location, status FROM bins WHERE status = 'Active' ORDER BY bin_identifier ASC";
            $result = mysqli_query($conn, $sql);
            if ($result) {
                $bins = mysqli_fetch_all($result, MYSQLI_ASSOC);
                $response = ['success' => true, 'data' => $bins];
                mysqli_free_result($result);
            } else {
                throw new Exception("Error fetching bins: " . mysqli_error($conn));
            }
            break;

        case 'get_deleted_bins':
             $sql = "SELECT id, bin_identifier, location FROM bins WHERE status = 'Deleted' ORDER BY updated_at DESC"; // Order by when deleted
             $result = mysqli_query($conn, $sql);
             if ($result) {
                 $bins = mysqli_fetch_all($result, MYSQLI_ASSOC);
                 $response = ['success' => true, 'data' => $bins];
                 mysqli_free_result($result);
             } else {
                 throw new Exception("Error fetching deleted bins: " . mysqli_error($conn));
             }
             break;

        case 'get_bin_details':
            $bin_id = filter_input(INPUT_GET, 'bin_id', FILTER_VALIDATE_INT);
            if (!$bin_id) {
                throw new Exception("Invalid or missing Bin ID.");
            }

            // Fetch Bin Details
            $stmt_bin = mysqli_prepare($conn, "SELECT id, bin_identifier, location, status, last_maintenance, air_quality_status FROM bins WHERE id = ?");
            mysqli_stmt_bind_param($stmt_bin, "i", $bin_id);
            mysqli_stmt_execute($stmt_bin);
            $result_bin = mysqli_stmt_get_result($stmt_bin);
            $binDetails = mysqli_fetch_assoc($result_bin);
            mysqli_stmt_close($stmt_bin);

            if (!$binDetails) {
                 throw new Exception("Bin not found.");
            }

            // Fetch Sensors
            $stmt_sensors = mysqli_prepare($conn, "SELECT id, sensor_name FROM sensors WHERE bin_id = ? ORDER BY sensor_name");
            mysqli_stmt_bind_param($stmt_sensors, "i", $bin_id);
            mysqli_stmt_execute($stmt_sensors);
            $result_sensors = mysqli_stmt_get_result($stmt_sensors);
            $sensors = mysqli_fetch_all($result_sensors, MYSQLI_ASSOC);
            mysqli_stmt_close($stmt_sensors);

            // Fetch Recent Sensor Readings (Example: Last 6 readings per sensor)
            // NOTE: This is a simplified approach. Real-world might need more complex queries or separate endpoints
            $readings = [];
            foreach ($sensors as $sensor) {
                 $stmt_readings = mysqli_prepare($conn, "SELECT reading_value, reading_timestamp FROM sensor_readings WHERE sensor_id = ? ORDER BY reading_timestamp DESC LIMIT 6");
                 mysqli_stmt_bind_param($stmt_readings, "i", $sensor['id']);
                 mysqli_stmt_execute($stmt_readings);
                 $result_readings = mysqli_stmt_get_result($stmt_readings);
                 $sensorReadings = mysqli_fetch_all($result_readings, MYSQLI_ASSOC);
                 mysqli_stmt_close($stmt_readings);
                 // Reverse to get oldest first for charting
                 $readings[$sensor['id']] = array_reverse($sensorReadings);
            }


            $response = [
                'success' => true,
                'data' => [
                    'details' => $binDetails,
                    'sensors' => $sensors,
                    'readings' => $readings // Contains readings keyed by sensor_id
                ]
            ];
            break;

        // --- POST/UPDATE ACTIONS ---
        case 'add_bin':
            // Generate next identifier based on highest existing one or starting from 1
             $result = mysqli_query($conn, "SELECT MAX(CAST(SUBSTRING(bin_identifier, 5) AS UNSIGNED)) as max_num FROM bins");
             $row = mysqli_fetch_assoc($result);
             $nextNum = ($row && $row['max_num'] !== null) ? intval($row['max_num']) + 1 : 1;
             $newBinIdentifier = "Bin " . str_pad($nextNum, 3, '0', STR_PAD_LEFT);
             $newLocation = "New Location " . $nextNum; // Default location

            $stmt = mysqli_prepare($conn, "INSERT INTO bins (bin_identifier, location, status) VALUES (?, ?, 'Active')");
            mysqli_stmt_bind_param($stmt, "ss", $newBinIdentifier, $newLocation);
            if (mysqli_stmt_execute($stmt)) {
                $new_bin_id = mysqli_insert_id($conn); // Get the ID of the inserted row
                 // Add default sensors for the new bin
                 $defaultSensors = [
                     'Particulate Matter (PM2.5/PM10)', 'Carbon Monoxide (CO)',
                     'Carbon Dioxide (CO2)', 'Total Volatile Organic Compounds (TVOC)'
                 ];
                 $stmt_sensor_insert = mysqli_prepare($conn, "INSERT INTO sensors (bin_id, sensor_name) VALUES (?, ?)");
                 foreach ($defaultSensors as $sensorName) {
                     mysqli_stmt_bind_param($stmt_sensor_insert, "is", $new_bin_id, $sensorName);
                     mysqli_stmt_execute($stmt_sensor_insert);
                 }
                 mysqli_stmt_close($stmt_sensor_insert);

                $response = ['success' => true, 'message' => 'Bin added successfully.', 'newBin' => ['id' => $new_bin_id, 'bin_identifier' => $newBinIdentifier, 'location' => $newLocation, 'status' => 'Active']];
            } else {
                throw new Exception("Error adding bin: " . mysqli_stmt_error($stmt));
            }
            mysqli_stmt_close($stmt);
            break;

        case 'delete_bin': // Mark as Deleted
            $bin_id = filter_input(INPUT_POST, 'bin_id', FILTER_VALIDATE_INT);
            if (!$bin_id) {
                throw new Exception("Invalid or missing Bin ID.");
            }
            $stmt = mysqli_prepare($conn, "UPDATE bins SET status = 'Deleted' WHERE id = ? AND status = 'Active'");
            mysqli_stmt_bind_param($stmt, "i", $bin_id);
            if (mysqli_stmt_execute($stmt)) {
                 $affected_rows = mysqli_stmt_affected_rows($stmt);
                 $response = ['success' => true, 'message' => ($affected_rows > 0) ? 'Bin marked as deleted.' : 'Bin not found or already deleted.'];
            } else {
                 throw new Exception("Error deleting bin: " . mysqli_stmt_error($stmt));
            }
            mysqli_stmt_close($stmt);
            break;

        case 'recover_bin': // Mark as Active
             $bin_id = filter_input(INPUT_POST, 'bin_id', FILTER_VALIDATE_INT);
             if (!$bin_id) {
                 throw new Exception("Invalid or missing Bin ID.");
             }
             // Fetch bin details before updating status to return them
             $stmt_fetch = mysqli_prepare($conn, "SELECT id, bin_identifier, location, last_maintenance, air_quality_status FROM bins WHERE id = ? AND status = 'Deleted'");
             mysqli_stmt_bind_param($stmt_fetch, "i", $bin_id);
             mysqli_stmt_execute($stmt_fetch);
             $result_fetch = mysqli_stmt_get_result($stmt_fetch);
             $binData = mysqli_fetch_assoc($result_fetch);
             mysqli_stmt_close($stmt_fetch);

             if (!$binData) {
                 throw new Exception("Deleted bin not found.");
             }

             $stmt_update = mysqli_prepare($conn, "UPDATE bins SET status = 'Active' WHERE id = ? AND status = 'Deleted'");
             mysqli_stmt_bind_param($stmt_update, "i", $bin_id);
             if (mysqli_stmt_execute($stmt_update)) {
                  $affected_rows = mysqli_stmt_affected_rows($stmt_update);
                  $response = [
                      'success' => true,
                      'message' => ($affected_rows > 0) ? 'Bin recovered.' : 'Bin not found or already active.',
                      'recoveredBin' => ($affected_rows > 0) ? array_merge($binData, ['status' => 'Active']) : null // Add status back
                    ];
             } else {
                  throw new Exception("Error recovering bin: " . mysqli_stmt_error($stmt_update));
             }
             mysqli_stmt_close($stmt_update);
             break;

        case 'update_bin_detail':
             $bin_id = filter_input(INPUT_POST, 'bin_id', FILTER_VALIDATE_INT);
             $field_name = filter_input(INPUT_POST, 'field', FILTER_SANITIZE_STRING); // e.g., Location, Last Maintenance
             $new_value = filter_input(INPUT_POST, 'value', FILTER_SANITIZE_STRING); // Sanitize basic strings

             if (!$bin_id || !$field_name || $new_value === null) {
                 throw new Exception("Missing required fields for update.");
             }

             // Whitelist editable fields and map to column names
             $allowed_fields = [
                 'Location' => 'location',
                 'Last Maintenance' => 'last_maintenance'
                 // Add other editable fields here if needed
             ];

             if (!array_key_exists($field_name, $allowed_fields)) {
                 throw new Exception("Invalid field specified for update.");
             }
             $column_name = $allowed_fields[$field_name];

             // Prepare update statement
             $stmt = mysqli_prepare($conn, "UPDATE bins SET `$column_name` = ? WHERE id = ?");
             mysqli_stmt_bind_param($stmt, "si", $new_value, $bin_id);

             if (mysqli_stmt_execute($stmt)) {
                 $response = ['success' => true, 'message' => "$field_name updated successfully."];
             } else {
                 throw new Exception("Error updating $field_name: " . mysqli_stmt_error($stmt));
             }
             mysqli_stmt_close($stmt);
             break;

         case 'add_sensor':
              $bin_id = filter_input(INPUT_POST, 'bin_id', FILTER_VALIDATE_INT);
              $sensor_name = trim(filter_input(INPUT_POST, 'sensor_name', FILTER_SANITIZE_STRING));

              if (!$bin_id || empty($sensor_name)) {
                   throw new Exception("Missing Bin ID or Sensor Name.");
              }

              $stmt = mysqli_prepare($conn, "INSERT INTO sensors (bin_id, sensor_name) VALUES (?, ?)");
              mysqli_stmt_bind_param($stmt, "is", $bin_id, $sensor_name);
              if (mysqli_stmt_execute($stmt)) {
                  $new_sensor_id = mysqli_insert_id($conn);
                   $response = ['success' => true, 'message' => 'Sensor added.', 'newSensor' => ['id' => $new_sensor_id, 'sensor_name' => $sensor_name]];
              } else {
                   // Handle potential duplicate sensor name for the same bin if needed
                   throw new Exception("Error adding sensor: " . mysqli_stmt_error($stmt));
              }
              mysqli_stmt_close($stmt);
              break;

         case 'delete_sensor':
             $sensor_id = filter_input(INPUT_POST, 'sensor_id', FILTER_VALIDATE_INT); // Assuming frontend sends sensor_id
             if (!$sensor_id) {
                  throw new Exception("Invalid or missing Sensor ID.");
             }
             $stmt = mysqli_prepare($conn, "DELETE FROM sensors WHERE id = ?");
             mysqli_stmt_bind_param($stmt, "i", $sensor_id);
              if (mysqli_stmt_execute($stmt)) {
                  $response = ['success' => true, 'message' => 'Sensor removed.'];
              } else {
                   throw new Exception("Error removing sensor: " . mysqli_stmt_error($stmt));
              }
              mysqli_stmt_close($stmt);
             break;

         case 'update_sensor_reading': // Renamed from update_sensor
              $sensor_id = filter_input(INPUT_POST, 'sensor_id', FILTER_VALIDATE_INT);
              $value = filter_input(INPUT_POST, 'value', FILTER_SANITIZE_STRING); // Keep as string initially for 'N/A' check

              if (!$sensor_id || $value === null) {
                   throw new Exception("Missing Sensor ID or Value.");
              }

             // Only insert numerical readings into the history table
             $reading_value = null;
             if ($value !== 'N/A' && is_numeric($value)) {
                 $reading_value = floatval($value);
                 $stmt = mysqli_prepare($conn, "INSERT INTO sensor_readings (sensor_id, reading_value) VALUES (?, ?)");
                 mysqli_stmt_bind_param($stmt, "id", $sensor_id, $reading_value);
                 if (mysqli_stmt_execute($stmt)) {
                     $response = ['success' => true, 'message' => 'Sensor reading added.'];
                 } else {
                     throw new Exception("Error adding sensor reading: " . mysqli_stmt_error($stmt));
                 }
                 mysqli_stmt_close($stmt);
             } else {
                 // If value is N/A or non-numeric, don't add to history, just confirm success
                 $response = ['success' => true, 'message' => 'Sensor value set (no history added).'];
             }
              // Update air quality status for the bin after adding a reading
              // This is complex: requires fetching the bin_id from sensor_id, then recalculating
              // For simplicity, this example doesn't automatically update air quality on reading change
              // It relies on the frontend recalculating it visually when the modal is open.
              // A better approach might be a separate job or trigger in the DB.
              break;

              case 'submit_contact':
                if (!$isWriteOperation) { // Double check it's a POST request
                    throw new Exception("Invalid request method for submit_contact. POST required.");
                }
    
                // 1. Get data using filter_input for basic security
                $name = filter_input(INPUT_POST, 'contact_name', FILTER_SANITIZE_STRING);
                $email = filter_input(INPUT_POST, 'contact_email', FILTER_VALIDATE_EMAIL);
                $message = filter_input(INPUT_POST, 'contact_message', FILTER_SANITIZE_STRING);
    
                // 2. Basic Validation (Check if fields are empty or email is invalid)
                if (empty($name) || empty($email) || empty($message)) {
                    throw new Exception("Please fill in all required fields.");
                }
                if (!$email) { // filter_input returns false if validation fails
                    throw new Exception("Invalid email format provided.");
                }
    
                // 3. Prepare INSERT statement (Prevents SQL Injection)
                $stmt = mysqli_prepare($conn, "INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)");
                if (!$stmt) {
                    // Log detailed error for debugging, throw generic one
                    error_log("MySQL Prepare Error (submit_contact): " . mysqli_error($conn));
                    throw new Exception("Database statement could not be prepared.");
                }
    
                // 4. Bind parameters to the prepared statement
                // 'sss' means all three parameters are treated as strings
                mysqli_stmt_bind_param($stmt, "sss", $name, $email, $message);
    
                // 5. Execute the prepared statement
                if (mysqli_stmt_execute($stmt)) {
                    $affected_rows = mysqli_stmt_affected_rows($stmt);
                     if ($affected_rows > 0) {
                        // 6. Set Success Response if insertion worked
                        $response = ['success' => true, 'message' => 'Message sent successfully! Thank you.'];
                        error_log("Contact message saved: Name=$name, Email=$email"); // Log success
                     } else {
                          // Should not happen if execute succeeded, but good to check
                          throw new Exception("Failed to save message. No rows affected unexpectedly.");
                     }
                } else {
                    // Execution failed
                     error_log("MySQL Execute Error (submit_contact): " . mysqli_stmt_error($stmt));
                    throw new Exception("Error saving message to database.");
                }
                mysqli_stmt_close($stmt); // Close the statement
                break;


                default: // Handle unknown actions
                $response['message'] = "Unknown API action specified: " . htmlspecialchars($action);
                 if (http_response_code() < 400) http_response_code(400); // Bad Request
                break;
    }

    if ($isWriteOperation && isset($response['success']) && $response['success']) {
        mysqli_commit($conn);
        error_log("Transaction committed for action: " . $action);
     } elseif ($isWriteOperation) { // Rollback if write failed
        mysqli_rollback($conn);
        error_log("Transaction rolled back for action: " . $action);
     }

} catch (Exception $e) {
    if ($isWriteOperation || mysqli_errno($conn)) mysqli_rollback($conn); // Rollback on error if applicable
    error_log("API Exception (" . $action . "): " . $e->getMessage());
    $response = ['success' => false, 'message' => $e->getMessage()]; // Send back the error message
    if (http_response_code() < 400) http_response_code(500); // Internal Server Error status
} finally {
    if (isset($conn)) mysqli_close($conn);
}


// Output the JSON response
echo json_encode($response);
exit; // Ensure no further output

?>