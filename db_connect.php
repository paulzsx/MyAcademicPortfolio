<?php
// --- Connection Details ---
$servername = "localhost"; // Or "127.0.0.1"
$username = "root";
$password = ""; // Default XAMPP root password (leave blank if none)
$dbname = "fairlter_db"; // The database name you created
$port = 3306;

// --- Create Connection ---
$conn = mysqli_connect($servername, $username, $password, $dbname, $port);

// --- Check Connection ---
if (!$conn) {
    // Important: Don't echo sensitive details in production
    // Log errors instead
    // For development:
    error_log("Database Connection Failed: " . mysqli_connect_error()); // Log to PHP error log
    // Send a generic error response
    http_response_code(500); // Internal Server Error
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'Database connection error.']);
    exit; // Stop script execution
}

// Set charset to handle special characters properly
mysqli_set_charset($conn, "utf8mb4");

?>