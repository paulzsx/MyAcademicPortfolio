'use strict';

/* ====================================== */
/* === Constants & State Variables === */
/* ====================================== */
const API_URL = 'api/index.php'; // ENSURE THIS PATH IS CORRECT relative to index.html
const BAD_STATUS_THRESHOLD = 100;
const defaultMapCenter = [8.2280, 124.2451]; // Approx Iligan City

// DEMO coordinates lookup (Replace with actual data source if available)
const locationCoordinates = {
    "MSU-IIT": [8.2398, 124.2448],
    "SMC": [8.2287, 124.2396],
    "AMCC": [8.24063, 124.24791],
    "SPC": [8.2318, 124.2364],
    "ICC": [8.2224, 124.2406]
};

let activeCharts = {};   // { binDbId: chartInstance }
let currentModalBinId = null; // Track which bin DB ID's modal is open
// let deletedBinsData = []; // Removed: Data fetched from server now
let mapInstance = null;   // Leaflet map instance
let mapMarkers = [];    // Array to hold Leaflet markers

/* ====================================== */
/* === DOM Element References === */
/* ====================================== */
const header = document.querySelector('.header');
const footer = document.querySelector('.footer');
const addBinButton = document.getElementById('add-bin-btn');
const deletedBinsButton = document.getElementById('deleted-bins-btn');
const viewMapButton = document.getElementById('view-map-btn');
const binsGrid = document.querySelector('.bins-grid');
const searchInput = document.getElementById('bin-search-input');
const deletedBinsModal = document.getElementById('deleted-bins-modal');
const deletedBinsTableBody = document.getElementById('deleted-bins-table')?.querySelector('tbody');
const mapModal = document.getElementById('map-modal');
const mapContainer = document.getElementById('map-container');
const contactForm = document.getElementById('contact-form');
const contactResultMessage = document.getElementById('contact-result-message');

/* ====================================== */
/* === Helper Functions === */
/* ====================================== */

/**
 * Escapes HTML special characters in a string.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHTML(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}

/**
 * Determines sensor status text and class based on value.
 * @param {string|number} value The sensor value.
 * @returns {object} Object with { text: 'N/A'|'Safe'|'Bad', class: ''|'status-safe'|'status-bad' }
 */
function determineStatus(value) {
     const numValue = parseFloat(value);
    if (value === 'N/A' || String(value).trim() === '' || isNaN(numValue)) {
        return { text: 'N/A', class: '' };
    }
    if (numValue > BAD_STATUS_THRESHOLD) {
        return { text: 'Bad', class: 'status-bad' };
    } else {
        return { text: 'Safe', class: 'status-safe' };
    }
}

/* ====================================== */
/* === Modal Handling === */
/* ====================================== */

/**
 * Cancels an ongoing detail edit within a modal if one exists.
 * @param {HTMLElement} modalElement The modal element to check.
 */
function cancelDetailEditIfNeeded(modalElement) {
     if (!modalElement) return;
     const editingDetailRow = modalElement.querySelector('.detail-table tbody tr.editing');
     if (editingDetailRow) {
         const valueCell = editingDetailRow.cells[1];
         const actionCell = editingDetailRow.cells[2];
         const fieldName = editingDetailRow.cells[0].textContent.trim();
         if (valueCell && actionCell && fieldName) {
             valueCell.querySelector('.detail-value-input').style.display = 'none';
             valueCell.querySelector('.detail-value-display').style.display = 'inline-block';
             actionCell.innerHTML = `<button class="action-btn edit-btn" onclick="editDetail(this, '${fieldName}')">Edit</button>`;
             editingDetailRow.classList.remove('editing');
             console.log(`Automatically cancelled detail edit for ${fieldName}.`);
        }
     }
}

/**
 * Closes a given modal element and performs necessary cleanup.
 * @param {HTMLElement} modalElement The modal element to close.
 */
function closeModal(modalElement) {
     if (!modalElement || modalElement.style.display === 'none') return;

     header.style.display = '';
     footer.style.display = '';
     const modalId = modalElement.id;

     // Use DB ID for cleanup
     if (modalId.startsWith('bin-') && modalId.endsWith('-modal')) {
        const binDbId = parseInt(modalId.split('-')[1]);
          if (activeCharts[binDbId]) {
              activeCharts[binDbId].destroy();
              delete activeCharts[binDbId];
              console.log(`Chart destroyed for Bin DB ID ${binDbId}`);
          }
          cancelDetailEditIfNeeded(modalElement);
          if (currentModalBinId === binDbId) {
              currentModalBinId = null;
          }
      }

     if (window.location.hash === `#${modalId}`) {
        window.location.hash = '#'; // Go to neutral state (or '#bins')
     }
     modalElement.style.display = 'none';
}

/**
 * Adds event listeners for closing a modal (overlay click and 'X' button).
 * @param {HTMLElement} modal The modal element.
 */
function addModalCloseListeners(modal) {
    if (!modal) return;
    const closeButton = modal.querySelector('.close');

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal(modal);
    });

    if (closeButton && !closeButton.getAttribute('onclick')) {
         closeButton.addEventListener('click', (event) => {
            event.preventDefault();
            closeModal(modal);
        });
    }
}

/* ====================================== */
/* === Bin Detail Editing (Frontend) === */
/* ====================================== */

/**
 * Enables editing mode for a specific detail field.
 * @param {HTMLButtonElement} button The 'Edit' button clicked.
 * @param {string} fieldName The name of the field.
 */
function editDetail(button, fieldName) {
     const row = button.closest('tr');
     if (!row) return;
     const currentTableBody = row.parentNode;
     const currentlyEditingRow = currentTableBody.querySelector('tr.editing');
     if (currentlyEditingRow && currentlyEditingRow !== row) {
          alert("Please save or cancel the currently editing detail first."); return;
     }
     row.classList.add('editing');
     const valueCell = row.cells[1];
     const valueDisplay = valueCell.querySelector('.detail-value-display');
     const valueInput = valueCell.querySelector('.detail-value-input');
     const actionCell = button.closest('td');
     if (!valueDisplay || !valueInput || !actionCell) {
         row.classList.remove('editing'); console.error("Edit detail elements missing."); return;
     }
     valueInput.value = valueDisplay.textContent.trim();
     valueDisplay.style.display = 'none';
     valueInput.style.display = 'inline-block';
     valueInput.focus(); valueInput.select();
     actionCell.innerHTML = `<button class="action-btn save-btn" onclick="saveDetail(this, '${fieldName}')">Save</button>`;
 }

/**
 * Saves the edited bin detail to the backend.
 * @param {HTMLButtonElement} button The 'Save' button clicked.
 * @param {string} fieldName The name of the field.
 */
 async function saveDetail(button, fieldName) {
     const row = button.closest('tr');
     if (!row || !row.classList.contains('editing')) return;
     const valueCell = row.cells[1];
     const valueInput = valueCell.querySelector('.detail-value-input');
     const actionCell = row.cells[2];
     const modal = row.closest('.modal');
     const binDbId = modal ? parseInt(modal.id.split('-')[1]) : null;

     if (!valueInput || !actionCell || !modal || !binDbId) {
         console.error("Save detail elements missing or invalid."); return;
     }
     const newValue = valueInput.value.trim();
     if (fieldName === 'Location' && newValue === '') {
          alert('Location cannot be empty.'); valueInput.focus(); return;
     }

     const formData = new FormData();
     formData.append('action', 'update_bin_detail');
     formData.append('bin_id', binDbId);
     formData.append('field', fieldName);
     formData.append('value', newValue);

     try {
         const response = await fetch(API_URL, { method: 'POST', body: formData });
         const result = await response.json();
         if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

         if (result.success) {
             const valueDisplay = valueCell.querySelector('.detail-value-display');
             valueDisplay.textContent = newValue;
             valueInput.setAttribute('value', newValue);
             valueInput.style.display = 'none';
             valueDisplay.style.display = 'inline-block';
             actionCell.innerHTML = `<button class="action-btn edit-btn" onclick="editDetail(this, '${fieldName}')">Edit</button>`;
             row.classList.remove('editing');

             const modalContent = row.closest('.modal-content');
             const binIdPadded = modalContent.querySelector('.detail-table tbody tr:first-child td:nth-child(2)').textContent.trim();
             if (fieldName === 'Location') {
                 const modalTitle = modalContent.querySelector('h2');
                 if (modalTitle) modalTitle.textContent = `${binIdPadded} – ${newValue}`;
                 const correspondingCard = document.getElementById(`card-db-${binDbId}`);
                 if (correspondingCard) {
                     const locationElement = correspondingCard.querySelector('.roast');
                     if (locationElement) locationElement.textContent = `Location: ${newValue}`;
                 }
                 // TODO: Potentially update map marker if map functionality is complex
             }
             console.log(result.message);
         } else {
             alert(`Error updating detail: ${result.message}`);
         }
     } catch (error) {
         console.error("Error saving detail:", error);
         alert("An error occurred while saving. Please try again.");
     }
  }

/* ====================================== */
/* === Sensor CRUD & Air Quality (Frontend) === */
/* ====================================== */

/**
 * Updates the Air Quality field based on sensor statuses.
 * @param {HTMLTableElement} sensorTableElement The sensor table element.
 */
 function updateOverallAirQuality(sensorTableElement) {
    if (!sensorTableElement) return;
     const modalContent = sensorTableElement.closest('.modal-content');
     if (!modalContent) return;
     const detailsTable = modalContent.querySelector('.detail-table');
     if (!detailsTable) return;
     let airQualityCell = null;
     const detailRows = detailsTable.querySelectorAll('tbody tr');
     detailRows.forEach(row => {
         const fieldCell = row.querySelector('td:first-child');
         if (fieldCell && fieldCell.textContent.trim() === 'Air Quality') {
              airQualityCell = row.cells[1];
          }
     });
     if (!airQualityCell) return;
     let isAnySensorBad = false, isAnySensorSafe = false;
     const sensorRows = sensorTableElement.querySelectorAll('tbody tr');
     sensorRows.forEach(sensorRow => {
         const statusCell = sensorRow.cells[2];
         if (statusCell) {
             const statusText = statusCell.textContent.trim();
             if (statusText === 'Bad') isAnySensorBad = true;
             else if (statusText === 'Safe') isAnySensorSafe = true;
         }
     });
     if (isAnySensorBad) {
         airQualityCell.textContent = 'Bad'; airQualityCell.style.color = '#dc3545'; airQualityCell.style.fontWeight = 'bold';
     } else if (isAnySensorSafe) {
         airQualityCell.textContent = 'Good'; airQualityCell.style.color = ''; airQualityCell.style.fontWeight = 'normal';
     } else {
         airQualityCell.textContent = 'N/A'; airQualityCell.style.color = ''; airQualityCell.style.fontWeight = 'normal';
    }
 }

/**
 * Adds a new sensor to the backend and UI.
 * @param {number} binDbId The Database ID of the bin.
 */
 async function addSensor(binDbId) {
     const nameInput = document.getElementById(`sensor-name-${binDbId}`);
     const sensorName = nameInput ? nameInput.value.trim() : null;
     if (!sensorName) { alert('Please enter the sensor name.'); return; }

     const formData = new FormData();
     formData.append('action', 'add_sensor');
     formData.append('bin_id', binDbId);
     formData.append('sensor_name', sensorName);

     try {
         const response = await fetch(API_URL, { method: 'POST', body: formData });
         const result = await response.json();
         if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

         if (result.success && result.newSensor) {
             const table = document.getElementById(`sensor-table-${binDbId}`);
             if (!table) return;
             let tableBody = table.querySelector('tbody');
             if (!tableBody) tableBody = table.createTBody();

             const newSensorData = result.newSensor;
             const initialValue = "N/A";
             const statusInfo = determineStatus(initialValue);
             const newRow = tableBody.insertRow();
             newRow.dataset.sensorId = newSensorData.id; // Store sensor DB ID

             newRow.insertCell().textContent = newSensorData.sensor_name;
             newRow.insertCell().innerHTML = `<span class="value-display">${initialValue}</span><input type="number" class="value-input" value="" style="display: none;">`;
             const statusCell = newRow.insertCell();
             statusCell.textContent = statusInfo.text; statusCell.className = statusInfo.class;
             newRow.insertCell().innerHTML = `<button class="action-btn edit-btn" onclick="editSensor(this)">Edit</button><button class="action-btn remove-btn" onclick="removeSensor(this)">Remove</button>`;

             if(nameInput) nameInput.value = '';
             updateOverallAirQuality(table);
             console.log(result.message);
         } else {
             alert(`Error adding sensor: ${result.message}`);
         }
     } catch (error) {
         console.error("Error adding sensor:", error);
         alert("An error occurred while adding the sensor.");
     }
 }

 /**
  * Puts a sensor row into editing mode.
  * @param {HTMLButtonElement} button The edit button clicked.
  */
 function editSensor(button) {
     const row = button.closest('tr');
     if (!row) return;
     const currentlyEditing = row.parentNode.querySelector('tr.editing');
     if (currentlyEditing && currentlyEditing !== row) { alert("Save/cancel other edit first."); return; }
     row.classList.add('editing');
     const valueDisplay = row.querySelector('.value-display');
     const valueInput = row.querySelector('.value-input');
     const actionCell = button.closest('td');
     if (!valueDisplay || !valueInput || !actionCell) { row.classList.remove('editing'); return; }
     const currentValue = valueDisplay.textContent.trim();
     valueInput.value = (currentValue === 'N/A' || currentValue === '') ? '' : currentValue;
     valueDisplay.style.display = 'none'; valueInput.style.display = 'inline-block';
     valueInput.focus(); valueInput.select();
     const hasRemoveButton = actionCell.querySelector('.remove-btn') !== null;
     actionCell.innerHTML = `<button class="action-btn save-btn" onclick="saveSensor(this)">Save</button>${hasRemoveButton ? '<button class="action-btn remove-btn" onclick="removeSensor(this)">Remove</button>' : ''}`;
  }

 /**
  * Saves the edited sensor value (submits reading to backend).
  * @param {HTMLButtonElement} button The save button clicked.
  */
 async function saveSensor(button) {
     const row = button.closest('tr');
     if (!row || !row.classList.contains('editing')) return;
     const sensorDbId = row.dataset.sensorId;
     if (!sensorDbId) { console.error("Sensor ID not found."); return; }
     const valueInput = row.querySelector('.value-input');
     const newValue = valueInput ? valueInput.value.trim() : null;
     if (newValue === null) return;

     let displayValue = 'N/A', valueForDb = 'N/A';
     if (newValue !== '') {
         const numValue = parseFloat(newValue);
         if (isNaN(numValue)) { alert('Enter number or leave blank for N/A.'); valueInput.focus(); return; }
         displayValue = newValue; valueForDb = newValue;
     }

     const formData = new FormData();
     formData.append('action', 'update_sensor_reading');
     formData.append('sensor_id', sensorDbId);
     formData.append('value', valueForDb);
      try {
         const response = await fetch(API_URL, { method: 'POST', body: formData });
         const result = await response.json();
         if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

         if (result.success) {
             // Update UI
             const table = row.closest('table.sensor-table');
             const valueDisplay = row.querySelector('.value-display');
             const statusCell = row.cells[2];
             const actionCell = row.cells[3];
             row.classList.remove('editing');
             if (valueDisplay) valueDisplay.textContent = displayValue;
             if (valueInput) valueInput.setAttribute('value', (displayValue === 'N/A' ? '' : displayValue));
             const statusInfo = determineStatus(displayValue);
             if (statusCell) { statusCell.textContent = statusInfo.text; statusCell.className = statusInfo.class; }
             if (valueInput) valueInput.style.display = 'none';
             if (valueDisplay) valueDisplay.style.display = 'inline-block';
             const hasRemoveButton = actionCell?.querySelector('.remove-btn') !== null;
             if (actionCell) actionCell.innerHTML = `<button class="action-btn edit-btn" onclick="editSensor(this)">Edit</button>${hasRemoveButton ? '<button class="action-btn remove-btn" onclick="removeSensor(this)">Remove</button>' : ''}`;
             if (table) updateOverallAirQuality(table);
             console.log(result.message);
             // TODO: Potentially update chart data here if needed immediately
         } else {
             alert(`Error saving sensor value: ${result.message}`);
         }
     } catch (error) {
         console.error("Error saving sensor value:", error);
         alert("An error occurred while saving sensor value.");
     }
 }

 /**
  * Deletes a sensor from the backend and UI.
  * @param {HTMLButtonElement} button The remove button clicked.
  */
 async function removeSensor(button) {
     const row = button.closest('tr');
     if (!row) return;
     if (row.classList.contains('editing')) { alert("Save/cancel edit first."); return; }
     const sensorDbId = row.dataset.sensorId;
      if (!sensorDbId) { console.error("Sensor ID not found."); return; }
     if (confirm('Are you sure you want to remove this sensor entry?')) {
         const formData = new FormData();
         formData.append('action', 'delete_sensor');
         formData.append('sensor_id', sensorDbId);
         try {
             const response = await fetch(API_URL, { method: 'POST', body: formData });
             const result = await response.json();
             if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

             if (result.success) {
                 const table = row.closest('table.sensor-table');
                 row.remove();
                 if (table) updateOverallAirQuality(table);
                 console.log(result.message);
             } else {
                 alert(`Error removing sensor: ${result.message}`);
             }
         } catch (error) {
              console.error("Error removing sensor:", error);
             alert("An error occurred while removing sensor.");
         }
     }
  }


/* ====================================== */
/* === Bin Management (Frontend) === */
/* ====================================== */

/**
 * Creates HTML elements (card, modal shell) for a bin using data from API.
 * @param {object} binDataFromApi Object with bin details from the backend.
 * @returns {object} { card: HTMLElement, modal: HTMLElement }
 */
 function createBinElements(binDataFromApi) {
    // Use DB data now
    const binDbId = binDataFromApi.id; // DB primary key
    const binIdPadded = binDataFromApi.bin_identifier;
    const location = binDataFromApi.location || 'N/A';
    const status = binDataFromApi.status || 'N/A';

    // Card HTML
    const card = document.createElement('a');
    card.href = `#bin-${binDbId}-modal`;
    card.classList.add('card');
    card.id = `card-db-${binDbId}`;
    card.innerHTML = `
        <button class="delete-bin-btn" title="Delete Bin">×</button>
        <img src="prototype.png" alt="${escapeHTML(binIdPadded)}" class="bin-image" />
        <div class="card-content">
            <h3>${escapeHTML(binIdPadded)}</h3>
            <p class="roast">Location: ${escapeHTML(location)}</p>
            <p class="price">Status: ${escapeHTML(status)}</p>
        </div>`;

    // Modal HTML (Shell only - details loaded on demand)
    const modal = document.createElement('div');
    modal.id = `bin-${binDbId}-modal`;
    modal.classList.add('modal');
    modal.innerHTML = `
        <div class="modal-content">
            <a href="#" class="close">×</a> <!-- JS handles close -->
            <h2>${escapeHTML(binIdPadded)} – ${escapeHTML(location)}</h2>
            <div class="table-wrapper">
                <table class="styled-table detail-table" id="detail-table-${binDbId}">
                   <thead><tr><th>Field</th><th>Value</th><th>Action</th></tr></thead>
                   <tbody>
                       <tr><td>Bin ID</td><td>${escapeHTML(binIdPadded)}</td><td></td></tr>
                       <tr><td>Location</td><td><span class="detail-value-display">${escapeHTML(location)}</span><input type="text" class="detail-value-input" value="${escapeHTML(location)}" style="display: none;"></td><td><button class="action-btn edit-btn" onclick="editDetail(this, 'Location')">Edit</button></td></tr>
                       <tr><td>Status</td><td>${escapeHTML(status)}</td><td></td></tr>
                       <tr><td>Air Quality</td><td>Loading...</td><td></td></tr>
                       <tr><td>Last Maintenance</td><td><span class="detail-value-display">Loading...</span><input type="text" class="detail-value-input" value="" style="display: none;"></td><td><button class="action-btn edit-btn" onclick="editDetail(this, 'Last Maintenance')">Edit</button></td></tr>
                   </tbody>
                </table>
            </div>
            <h3>Sensors</h3>
            <div class="sensor-section">
                <div class="sensor-display-wrapper">
                    <div class="sensor-details-left">
                        <table class="sensor-table" id="sensor-table-${binDbId}">
                            <thead><tr><th>Sensor</th><th>Value</th><th>Status</th><th>Action</th></tr></thead>
                            <tbody><tr><td colspan="4" style="text-align:center;">Loading sensors...</td></tr></tbody>
                        </table>
                        <div class="sensor-form">
                            <input type="text" id="sensor-name-${binDbId}" placeholder="Add Sensor Name">
                            <button onclick="addSensor(${binDbId})">Add Sensor</button> <!-- Pass DB ID -->
                        </div>
                    </div>
                    <div class="sensor-graph-container">
                        <h4>Recent Sensor Readings</h4>
                        <canvas id="sensor-chart-${binDbId}"></canvas>
                        <p id="chart-loading-${binDbId}" style="text-align:center; display:none;">Loading chart data...</p>
                    </div>
                </div>
            </div>
        </div>`;
    return { card, modal };
  }

/**
 * Handles adding a new bin via API call.
 */
async function handleAddBin() {
    const formData = new FormData();
    formData.append('action', 'add_bin');
    try {
        const response = await fetch(API_URL, { method: 'POST', body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

        if (result.success && result.newBin) {
            const binDataFromApi = result.newBin;
            // Create elements using keys returned by PHP
            const binDataForElement = {
                id: binDataFromApi.id,
                bin_identifier: binDataFromApi.bin_identifier,
                location: binDataFromApi.location,
                status: binDataFromApi.status
            };
            const { card, modal } = createBinElements(binDataForElement);
            if(binsGrid) binsGrid.appendChild(card); // Append card
            document.body.appendChild(modal); // Append modal
            addModalCloseListeners(modal);    // Add listeners

            // Check against search
            const searchTerm = searchInput.value.toLowerCase().trim();
            if (searchTerm !== '' && !binDataFromApi.bin_identifier.toLowerCase().includes(searchTerm)) {
                 card.style.display = 'none';
            }
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            console.log(result.message);
        } else { alert(`Error adding bin: ${result.message}`); }
    } catch (error) {
        console.error("Error adding bin:", error);
        alert("An error occurred while adding bin.");
    }
 }

/**
 * Handles deleting a bin via API call (with detailed logging).
 *  @param {Event} event The click event object.
 */
async function handleDeleteBin(event) {
   if (!event.target.classList.contains('delete-bin-btn')) return;
    event.preventDefault(); event.stopPropagation();
    const cardToDelete = event.target.closest('.card');
    if (!cardToDelete) return;

    console.log("--- handleDeleteBin START ---");
    console.log("Delete Target:", event.target);
    console.log("Found Card:", cardToDelete);

    const modalHref = cardToDelete.getAttribute('href');
    console.log("Extracted Modal Href:", modalHref);
    if (!modalHref || !modalHref.startsWith('#bin-') || !modalHref.endsWith('-modal')) {
        console.error("FAILED: Invalid modal href:", modalHref); alert("Error identifying bin.");
        console.log("--- handleDeleteBin END (Error) ---"); return;
    }

    const modalId = modalHref.substring(1);
    const parts = modalId.split('-');
    console.log("Split href parts:", parts);
    let binDbId = null;
    if (parts.length === 3 && !isNaN(parseInt(parts[1]))) {
         binDbId = parseInt(parts[1]);
         console.log("Parsed Bin DB ID:", binDbId);
    } else {
         console.error("FAILED: Could not parse DB ID:", parts); alert("Error parsing bin ID.");
         console.log("--- handleDeleteBin END (Error) ---"); return;
    }

    const binName = cardToDelete.querySelector('h3')?.textContent || 'this bin';
    if (confirm(`Are you sure you want to delete ${binName}? This can be recovered.`)) {
        console.log(`Proceeding to delete bin DB ID: ${binDbId}`);
        const formData = new FormData();
        formData.append('action', 'delete_bin');
        formData.append('bin_id', binDbId);

        try {
            console.log("Sending delete request...");
            const response = await fetch(API_URL, { method: 'POST', body: formData });
            console.log("Delete API Response Status:", response.status, response.statusText);

            const result = await response.json(); // Assume JSON even on error for msg
            console.log("Delete API Parsed Result:", result);

             if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);

            if (result.success) {
                 const modalToDeleteId = `bin-${binDbId}-modal`;
                 const modalToDelete = document.getElementById(modalToDeleteId);
                 if (activeCharts[binDbId]) { activeCharts[binDbId].destroy(); delete activeCharts[binDbId]; }
                 if (cardToDelete) cardToDelete.remove();
                 if (modalToDelete) modalToDelete.remove();
                 if (window.location.hash === `#${modalToDeleteId}`) closeModal(modalToDelete); // Handle hash change
                 console.log("Delete successful:", result.message);
            } else {
                 console.error("Delete API reported failure:", result.message);
                 alert(`Error deleting bin: ${result.message}`);
            }
        } catch (error) {
            console.error("Catch block: Error deleting bin:", error);
            alert(`An error occurred while deleting the bin: ${error.message}`);
        }
    } else { console.log("Delete cancelled."); }
    console.log("--- handleDeleteBin END ---");
 }


/* ====================================== */
/* === Deleted Bins Functionality (Frontend) === */
/* ====================================== */

 async function updateDeletedBinsView() {
    if(!deletedBinsTableBody) { console.error("Deleted bins table missing"); return; }
     deletedBinsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">Loading...</td></tr>';
     try {
         const response = await fetch(`${API_URL}?action=get_deleted_bins`);
         const result = await response.json();
         if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);
         deletedBinsTableBody.innerHTML = '';
         if (result.success && result.data && result.data.length > 0) {
             result.data.forEach(binData => {
                 const row = deletedBinsTableBody.insertRow();
                 row.insertCell().textContent = binData.bin_identifier;
                 row.insertCell().textContent = binData.location;
                 const actionCell = row.insertCell(); actionCell.style.textAlign = 'right';
                 actionCell.innerHTML = `<button class="action-btn edit-btn" onclick="recoverBin(${binData.id})" title="Recover Bin">Recover</button>`;
             });
         } else {
             deletedBinsTableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No deleted bins found.</td></tr>';
         }
     } catch (error) {
         console.error("Error fetching deleted bins:", error);
         deletedBinsTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: red;">Could not fetch data.</td></tr>`;
     }
 }

 function handleViewDeletedBins() { updateDeletedBinsView(); window.location.hash = '#deleted-bins-modal'; }

 async function recoverBin(binDbId) {
     if (!binDbId) { console.error("Invalid Bin ID for recovery."); return; }
     const formData = new FormData();
     formData.append('action', 'recover_bin');
     formData.append('bin_id', binDbId);
      try {
         const response = await fetch(API_URL, { method: 'POST', body: formData });
         const result = await response.json();
         if (!response.ok) throw new Error(result.message || `HTTP error ${response.status}`);
         if (result.success && result.recoveredBin) {
              const binData = result.recoveredBin;
              // Map data for element creation
              const binDataForElement = {
                  id: binData.id, bin_identifier: binData.bin_identifier,
                  location: binData.location, status: binData.status,
                  // We get these back from the PHP now
                  last_maintenance: binData.last_maintenance,
                  air_quality_status: binData.air_quality_status
              };
              const { card, modal } = createBinElements(binDataForElement);
              binsGrid.appendChild(card);
              document.body.appendChild(modal);
              addModalCloseListeners(modal);
              updateDeletedBinsView();

              // Re-apply search filter
              const searchTerm = searchInput.value.toLowerCase().trim();
              if (searchTerm !== '' && card.querySelector('h3') && !card.querySelector('h3').textContent.toLowerCase().includes(searchTerm)) {
                   card.style.display = 'none';
              }
              console.log("Recovered:", binData.bin_identifier);
              alert(`${binData.bin_identifier} recovered successfully.`);
          } else { alert(`Error recovering bin: ${result.message || 'Unknown error.'}`); }
      } catch (error) { console.error("Error recovering bin:", error); alert("An error occurred while recovering the bin."); }
  }

/* ====================================== */
/* === Map Functionality (Frontend) === */
/* ====================================== */

/**
 * Handles showing the map modal and initializing/populating the Leaflet map
 * with markers for currently displayed (active) bins.
 */
function handleViewMap() {
    if (!mapModal || !mapContainer) {
        console.error("Map modal or container elements not found!"); return;
    }

    // Navigate to the map modal using hash
    window.location.hash = '#map-modal';

    // Use setTimeout to ensure the modal element is visible in the DOM
    // before Leaflet tries to initialize or interact with it.
    setTimeout(() => {
        // Initialize map only if it hasn't been done before
        if (!mapInstance) {
             console.log("Initializing Leaflet map...");
             try {
                 // Check if Leaflet library is loaded
                 if (typeof L === 'undefined') {
                      throw new Error("Leaflet library (L) is not loaded. Check CDN links.");
                  }
                 mapInstance = L.map(mapContainer).setView(defaultMapCenter, 14); // Set initial view
                 // Add the tile layer (map background)
                 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                     maxZoom: 19,
                     attribution: '© <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                 }).addTo(mapInstance);
             } catch (error) {
                 // Display error if map initialization fails
                 console.error("Error initializing Leaflet map:", error);
                 mapContainer.innerHTML = `<p style="color:red; text-align:center;">Error loading map: ${escapeHTML(error.message)}</p>`;
                 mapInstance = null; // Ensure instance is null on error
                 return;
             }
        } else {
             // If map instance already exists, invalidate its size
             // This is important if the modal was hidden and then reshown,
             // or if the container size changed.
             mapInstance.invalidateSize();
             console.log("Map instance already exists. Invalidating size.");
        }

        // Clear existing markers before adding new ones for the current view
        mapMarkers.forEach(marker => marker.remove());
        mapMarkers = []; // Reset the markers array
        const bounds = []; // To store coordinates for automatically fitting the map view

        // Find all *currently visible* bin cards in the grid
        const activeBinCards = binsGrid.querySelectorAll('.card[style*="display: block"], .card:not([style*="display: none"])'); // More robust selector for visible cards
        console.log(`Found ${activeBinCards.length} active bin cards to map.`);

        activeBinCards.forEach(card => {
            const binTitleElement = card.querySelector('h3');
            const locationElement = card.querySelector('.roast'); // Assumes location is in '.roast'
            const cardId = card.id; // e.g., card-db-1
            const binDbId = cardId ? parseInt(cardId.split('-')[2]) : null; // Extract DB ID


            if (binTitleElement && locationElement && binDbId) {
                const binIdText = binTitleElement.textContent.trim();
                const locationString = locationElement.textContent.replace('Location:', '').trim();

                // Look up coordinates (using predefined object for demo)
                let coordinates = locationCoordinates[locationString] || null;

                // Fallback for dynamically added "New Location X" (demo only)
                if (!coordinates && locationString.startsWith("New Location")) {
                     coordinates = [
                         defaultMapCenter[0] + (Math.random() - 0.5) * 0.01, // Add slight random offset
                         defaultMapCenter[1] + (Math.random() - 0.5) * 0.01
                     ];
                     console.warn(`Assigning random coordinates for demo location: ${locationString}`);
                }

                // If coordinates were found or generated, add a marker
                if (coordinates && mapInstance) { // Also check mapInstance exists
                     console.log(`Adding marker for ${binIdText} [ID: ${binDbId}] at ${coordinates}`);
                     const marker = L.marker(coordinates, {
                         // Store bin ID in marker options for potential future lookup
                         binId: binDbId
                     }).addTo(mapInstance)
                       .bindPopup(`<b>${escapeHTML(binIdText)}</b><br>${escapeHTML(locationString)}`); // Add popup info

                     mapMarkers.push(marker);  // Add marker to our tracking array
                     bounds.push(coordinates); // Add coordinates for map bounds calculation
                } else if (!coordinates){
                    console.warn(`Map coordinates not found for location string: "${locationString}" (Bin ID: ${binDbId})`);
                }
            } else {
                 console.warn("Could not extract details or DB ID from card:", card);
            }
        });

        // Adjust map view to fit all markers, or reset to default if no markers
        if (bounds.length > 0 && mapInstance) {
            console.log("Fitting map bounds to markers.");
            mapInstance.fitBounds(bounds, { padding: [50, 50] }); // Add padding around markers
        } else if (mapInstance) {
            console.log("No valid markers found, setting default map view.");
            mapInstance.setView(defaultMapCenter, 14); // Reset view if no markers found
        }
     }, 100); // Small delay to ensure modal is rendered before map init/resize
}

/* ====================================== */
/* === Charting Functionality (Frontend) === */
/* ====================================== */

/**
 * Creates/Updates sensor chart using fetched data.
 * @param {number} binDbId The Database ID of the bin.
 * @param {Array} sensorData Array of sensor objects {id, sensor_name}.
 * @param {object} readingsData Object mapping sensorId to array of readings [{reading_value, reading_timestamp}]. Readings array should be oldest first.
 */
 function createSensorChart(binDbId, sensorData = [], readingsData = {}) { // Added default empty values
     const canvasId = `sensor-chart-${binDbId}`;
     const canvas = document.getElementById(canvasId);
     const ctx = canvas?.getContext('2d'); // Use optional chaining
     const chartLoadingIndicator = document.getElementById(`chart-loading-${binDbId}`);

     // Hide loading text, show canvas (even if data is empty later)
     if(chartLoadingIndicator) chartLoadingIndicator.style.display = 'none';
     if(canvas) canvas.style.display = '';

     if (!ctx) {
         console.error(`Canvas context for ${canvasId} not found. Chart cannot be created.`);
         // Optionally display an error message in the chart area
         const container = canvas?.parentNode;
         if(container) container.innerHTML = `<p style="color:red; text-align:center;">Error displaying chart.</p>`;
         return;
      }

     // Destroy previous chart instance for this canvas if it exists
     if (activeCharts[binDbId]) {
         activeCharts[binDbId].destroy();
         delete activeCharts[binDbId];
         console.log(`Chart instance destroyed for Bin DB ID ${binDbId} before update.`);
     }

     const labels = [];
     const datasets = [];
     const colors = ['rgb(75, 192, 192)', 'rgb(255, 99, 132)', 'rgb(165, 42, 42)', 'rgb(128, 0, 128)', 'rgb(255, 159, 64)', 'rgb(54, 162, 235)'];
     const MAX_CHART_POINTS = 6; // Consistent with PHP LIMIT

     // --- Determine Chart Labels (X-axis) ---
     // Try to use timestamps from the first sensor with enough data
     let foundTimestamps = false;
     for (const sensor of sensorData) {
         const readings = Array.isArray(readingsData[sensor.id]) ? readingsData[sensor.id] : []; // Ensure it's an array
         const recentReadings = readings.slice(-MAX_CHART_POINTS); // Get last N readings
         if (recentReadings.length > 0) {
             labels.length = 0; // Clear previous labels if needed
             labels.push(...recentReadings.map(r => {
                 try {
                     let ts = r.reading_timestamp;
                     if (ts && !ts.includes('+') && !ts.includes('Z')) ts += ' UTC'; // Help JS Date parsing
                     // Format as HH:MM
                     return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                 } catch(e) { return '?'; } // Fallback for invalid timestamp
             }));
             // Pad start with generic labels if fewer than MAX points
             while (labels.length < MAX_CHART_POINTS && labels.length > 0) {
                 labels.unshift(`T-${MAX_CHART_POINTS - labels.length}`);
             }
             foundTimestamps = true;
             break; // Use labels from first valid sensor
         }
     }
     // Fallback to generic labels if no readings found
     if (!foundTimestamps) {
         labels.push(...Array.from({length: MAX_CHART_POINTS}, (_, i) => `T-${MAX_CHART_POINTS - 1 - i}`));
         if (labels.length > 0) labels[labels.length - 1] = "Now"; else labels.push("N/A");
     }
     // --- End Label Generation ---


     // --- Build Chart Datasets (Y-axis lines) ---
     (sensorData || []).forEach((sensor, index) => {
         const readings = readingsData[sensor.id] || [];
         const relevantReadings = readings.slice(-MAX_CHART_POINTS); // Get last N readings
         // Create an array matching label length, initially filled with nulls
         const dataPoints = Array(labels.length).fill(null);

          // Map readings to the correct slot based on fixed label length (last reading -> last slot)
         relevantReadings.forEach((r, i) => {
             const dataIndex = labels.length - relevantReadings.length + i;
             if(dataIndex >= 0 && dataIndex < labels.length) {
                 dataPoints[dataIndex] = r.reading_value ?? null; // Use reading value, or null if missing
             }
          });

         datasets.push({
             label: sensor.sensor_name || `Sensor ${sensor.id}`,
             data: dataPoints,
             borderColor: colors[index % colors.length],
             tension: 0.1,
             fill: false
         });
     });
      // --- End Dataset Generation ---


     // Chart.js Configuration Object
     const chartConfig = {
          type: 'line',
          data: {
              labels: labels,
              datasets: datasets
          },
          options: {
              responsive: true, // Make chart resize with container
              maintainAspectRatio: false, // Allow height to be controlled by CSS/container
              interaction: { // Improved tooltip interaction
                  mode: 'index',
                  intersect: false,
              },
              plugins: {
                  legend: { position: 'top', align: 'start' }, // Position legend
                  tooltip: { // Tooltip customization (optional)
                      // callbacks: { label: function(context) { /* ... */ } }
                  }
              },
              scales: {
                  x: {
                      display: true,
                      title: { display: false } // No X-axis title needed
                  },
                  y: {
                      display: true,
                      title: { display: false }, // No Y-axis title needed
                      beginAtZero: true // Start Y axis at 0
                  }
              }
          }
     };

     // Create the chart instance and store it
     try {
        activeCharts[binDbId] = new Chart(ctx, chartConfig);
        console.log(`Chart created/updated successfully for Bin DB ID ${binDbId}`);
     } catch (error) {
          console.error(`Chart.js error for Bin DB ID ${binDbId}:`, error);
          // Optionally display error message on the canvas container
           const container = canvas?.parentNode;
           if(container) container.innerHTML = `<p style="color:red; text-align:center;">Could not display chart.</p>`;
     }
  }

  /* ====================================== */
/* === Contact Form Handling === */
/* ====================================== */

/**
 * Handles the submission of the contact form.
 * @param {Event} event The submit event object.
 */
async function handleContactSubmit(event) {
    event.preventDefault(); // Prevent default page reload
    console.log("--- handleContactSubmit START ---");

    if (!contactForm || !contactResultMessage) {
        console.error("Contact form or result message element not found!");
        console.log("--- handleContactSubmit END (Error) ---");
        return;
    }

    const submitButton = contactForm.querySelector('button[type="submit"]');
    const originalButtonText = submitButton.textContent;

    // Disable button and show loading state
    submitButton.disabled = true;
    submitButton.textContent = 'SENDING...';
    contactResultMessage.textContent = ''; // Clear previous message
    contactResultMessage.style.color = ''; // Reset color

    const formData = new FormData(contactForm); // Get data from form inputs
    formData.append('action', 'submit_contact'); // Tell the backend action

    // Log the data being sent
    console.log("Form Data being sent:");
    for (let [key, value] of formData.entries()) {
        console.log(` -> ${key}: ${value}`);
    }

    try {
        console.log("Sending fetch request to:", API_URL);
        const response = await fetch(API_URL, {
            method: 'POST',
            body: formData
        });
        console.log("Fetch Response Status:", response.status, response.statusText);

        // Log raw response text BEFORE trying to parse as JSON
        const responseText = await response.text();
        console.log("Raw Response Text from Server:", responseText);

        let result;
        try { // Try to parse JSON
            result = JSON.parse(responseText);
            console.log("Parsed Server Response:", result);
        } catch (jsonError) {
            console.error("JSON Parsing Error:", jsonError);
            throw new Error("Received invalid non-JSON response from server.");
        }

        if (!response.ok) { // Check HTTP status after parsing attempt
             throw new Error(result.message || `HTTP Error ${response.status}`);
        }

        // Process the valid JSON result
        if (result.success) {
            contactResultMessage.textContent = result.message || "Message sent successfully!";
            contactResultMessage.style.color = 'green';
            contactForm.reset(); // Clear the form fields
            console.log("Contact form submitted successfully.");
        } else {
             contactResultMessage.textContent = `Error: ${result.message || 'Could not send message.'}`;
             contactResultMessage.style.color = 'red';
             console.warn("API reported failure for contact submission:", result.message);
        }

    } catch (error) {
        console.error("Catch Block: Error submitting contact form:", error);
        contactResultMessage.textContent = `Error: ${error.message || 'Could not connect to server.'}`;
        contactResultMessage.style.color = 'red';
    } finally {
        // Re-enable button regardless of success/failure
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
        console.log("--- handleContactSubmit END ---"); // Log end
    }
}


/* ====================================== */
/* === Event Listeners Initialization === */
/* ====================================== */
// Search Input Listener
if (searchInput && binsGrid) {
    console.log("Attaching listener to search input:", searchInput); // Log listener attachment
    searchInput.addEventListener('input', () => { // 'input' triggers on any value change (typing, paste, clear)
        const searchTerm = searchInput.value.toLowerCase().trim(); // Get current search term, lowercase, trimmed
        const binCards = binsGrid.querySelectorAll('.card'); // Select ALL bin cards currently in the grid

        console.log(`Filtering bins with term: "${searchTerm}"`); // Log the search term

        // Loop through each card and decide whether to show or hide it
        binCards.forEach(card => {
            const titleElement = card.querySelector('h3'); // Find the h3 element containing the Bin ID/Identifier

            // Check if the title element exists and its text content includes the search term
            if (titleElement && titleElement.textContent.toLowerCase().includes(searchTerm)) {
                card.style.display = 'block'; // Show the card if it matches
            } else if (titleElement) { // It has a title, but doesn't match
                card.style.display = 'none';  // Hide the card if it doesn't match
            } else {
                 // Fallback: If a card somehow doesn't have an h3, show it? Or hide it? Decide based on desired behavior.
                 // Let's hide it to be safe, as it indicates missing data.
                  console.warn("Card found without h3 title element:", card);
                  card.style.display = 'none';
            }
        });
    });
} else {
    // Log error if either the input or the grid container wasn't found
    if (!searchInput) console.error("Search input element (#bin-search-input) not found!");
    if (!binsGrid) console.error("Bins grid element (.bins-grid) not found!");
}
// Button Listeners
if (addBinButton) addBinButton.addEventListener('click', handleAddBin);
if (deletedBinsButton) deletedBinsButton.addEventListener('click', handleViewDeletedBins);
if (viewMapButton) viewMapButton.addEventListener('click', handleViewMap);
// Bin Grid Event Delegation
// Bin Grid Event Delegation (Card Clicks & Delete Button)
if (binsGrid) { // Check if binsGrid element was found
    console.log("Attaching listener to binsGrid:", binsGrid); // <<< ADD THIS LINE
    binsGrid.addEventListener('click', (event) => {
        console.log("Click detected on binsGrid. Target:", event.target); // <<< ADD THIS LINE

        // Check if the delete button itself was the target
        if (event.target.classList.contains('delete-bin-btn')) {
            console.log("Delete button click identified. Calling handleDeleteBin..."); // <<< ADD THIS LINE
            handleDeleteBin(event); // Handle deletion
        } else {
            // Handle card click (allow default link behavior or check closest card)
             const cardLink = event.target.closest('.card');
             if (cardLink && event.target.tagName !== 'BUTTON') { // Don't process if delete btn was clicked somewhere inside card but not target
                 console.log("Card link click detected, allowing hash navigation.");
                // Let the browser navigate based on the href and hashchange listener handles the rest
             } else if (cardLink) {
                 console.log("Click inside card, but not processing as navigation (likely button).")
             } else {
                 console.log("Click inside grid, but not on a card or delete button.");
             }
        }
    });
} else {
    console.error("ERROR: binsGrid element not found! Cannot attach listener."); // <<< ADD THIS LINE
}
// Add Close Listeners to Static Modals
if(deletedBinsModal) addModalCloseListeners(deletedBinsModal);
if(mapModal) addModalCloseListeners(mapModal);
// Hash Change Listener
window.addEventListener('hashchange', async () => {
    const hash = window.location.hash;
    console.log("Hash changed to:", hash); // Log the hash change

    // Close any currently visible modal if the hash changed away from it
    const currentlyVisibleModal = document.querySelector('.modal[style*="display: block"]');
    if (currentlyVisibleModal && `#${currentlyVisibleModal.id}` !== hash) {
        closeModal(currentlyVisibleModal);
    }

    // --- Handle BIN Modals ---
    if (hash.startsWith('#bin-') && hash.endsWith('-modal')) {
        // Extract the database ID from the hash (e.g., #bin-1-modal -> 1)
        const binDbId = parseInt(hash.split('-')[1]);
        if (!binDbId || isNaN(binDbId)) {
            console.error("Invalid Bin ID in hash:", hash);
            return; // Exit if ID is not valid
        }

        // Find the corresponding modal element in the DOM
        let targetModal = document.getElementById(`bin-${binDbId}-modal`);
        if (!targetModal) {
            console.warn(`Modal element ${hash} not found. Cannot load details.`);
            // Optional: could try to load bins again here if it's expected to exist
            return;
        }

        // Show the target modal and hide header/footer
        targetModal.style.display = 'block';
        header.style.display = 'none';
        footer.style.display = 'none';
        const modalContent = targetModal.querySelector('.modal-content');
        if (modalContent) modalContent.scrollTop = 0; // Scroll modal to top
        currentModalBinId = binDbId; // Track which modal is open

        // --- Select elements within this specific modal for updating ---
        const detailTableBody = targetModal.querySelector(`#detail-table-${binDbId} tbody`);
        const sensorTableBody = targetModal.querySelector(`#sensor-table-${binDbId} tbody`);
        const chartLoading = document.getElementById(`chart-loading-${binDbId}`);
        const canvas = document.getElementById(`sensor-chart-${binDbId}`);

        // --- Set Loading States ---
        console.log(`Setting loading state for Bin ID ${binDbId}`);
        if (detailTableBody) {
             detailTableBody.querySelectorAll('tr').forEach(row => {
                 const fieldCell = row.cells[0];
                 const valueCell = row.cells[1];
                 const displaySpan = valueCell?.querySelector('.detail-value-display');
                 // Only reset fields that WILL be loaded dynamically
                 if (fieldCell && displaySpan && ['Air Quality', 'Last Maintenance'].includes(fieldCell.textContent.trim())) {
                      displaySpan.textContent = 'Loading...'; // Set to loading text
                      // Make sure corresponding input value is cleared if needed or relevant
                      const inputField = valueCell?.querySelector('.detail-value-input');
                      if(inputField) inputField.value = '';
                  }
                  // Ensure any ongoing edit in this modal is cancelled if user navigates away and back
                   if(row.classList.contains('editing')) cancelDetailEditIfNeeded(targetModal);
              });
          } else { console.warn("Detail table body not found for loading state."); }

          if(sensorTableBody) {
              sensorTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading sensors...</td></tr>'; // Set loading message for sensors
          } else { console.warn("Sensor table body not found for loading state."); }

          if(canvas) canvas.style.display = 'none'; // Hide old chart data
          if(chartLoading) chartLoading.style.display = 'block'; // Show chart loading text

        // --- Fetch Data for THIS bin from the backend ---
        try {
            console.log(`Fetching details for Bin ID ${binDbId}...`);
            const response = await fetch(`${API_URL}?action=get_bin_details&bin_id=${binDbId}`);
            console.log(`Fetch status for details (Bin ${binDbId}):`, response.status);

            const result = await response.json(); // Try to parse JSON response
             if (!response.ok) { // Check HTTP status AFTER parsing JSON if possible
                 throw new Error(result.message || `HTTP error ${response.status}`); // Use message from JSON if available
             }
            console.log(`Parsed details (Bin ${binDbId}):`, result);

            // Check if the API call itself was successful (based on OUR JSON structure)
            if (result.success && result.data) {
                const { details, sensors, readings } = result.data; // Destructure the payload

                 if (!details) throw new Error("Missing 'details' object in API response data.");
                 if (!sensors) throw new Error("Missing 'sensors' array in API response data.");
                 if (!readings) throw new Error("Missing 'readings' object in API response data.");


                // --- Populate Details Table ---
                 console.log("Populating details table...");
                 if (detailTableBody) {
                     detailTableBody.querySelectorAll('tr').forEach(row => {
                          const fieldCell = row.cells[0];
                          const valueCell = row.cells[1];
                          const displaySpan = valueCell?.querySelector('.detail-value-display');
                          const input = valueCell?.querySelector('.detail-value-input');

                          if (fieldCell && displaySpan) { // Only process rows with expected structure
                              const field = fieldCell.textContent.trim();
                              let newValue = 'N/A'; // Sensible default

                              // Map known detail fields from the 'details' object
                              switch(field) {
                                case 'Location': newValue = details.location ?? 'N/A'; break;
                                case 'Air Quality': newValue = details.air_quality_status ?? 'N/A'; break;
                                case 'Last Maintenance': newValue = details.last_maintenance ?? 'N/A'; break;
                                // Keep Bin ID and Status static from initial load, or update if needed:
                                // case 'Bin ID': newValue = details.bin_identifier ?? 'N/A'; break;
                                // case 'Status': newValue = details.status ?? 'N/A'; break;
                              }
                               // Update display span and hidden input for relevant fields
                               if (['Location', 'Air Quality', 'Last Maintenance'].includes(field)) {
                                   displaySpan.textContent = escapeHTML(newValue);
                                   if (input) input.value = newValue; // Use raw value for input
                               }
                           }
                       });
                  } else { console.warn("Detail table body missing when populating."); }

                 // --- Populate Sensor Table ---
                 const sensorTable = targetModal.querySelector(`#sensor-table-${binDbId}`);
                 console.log("Populating sensor table...");
                 if (sensorTableBody) {
                     sensorTableBody.innerHTML = ''; // Clear "Loading sensors..."
                     let sensorsPopulated = false;
                     if (Array.isArray(sensors) && sensors.length > 0) { // Check if sensors is a non-empty array
                         sensors.forEach(sensor => {
                             const sensorReadingsArray = readings[sensor.id] ?? []; // Get readings for this sensor, default to empty array
                             const lastReading = sensorReadingsArray.length > 0 ? sensorReadingsArray[sensorReadingsArray.length - 1] : null; // Get most recent reading
                             const lastReadingValue = lastReading ? lastReading.reading_value : 'N/A'; // Extract value or use N/A
                             const statusInfo = determineStatus(lastReadingValue); // Calculate status

                             const newRow = sensorTableBody.insertRow();
                             newRow.dataset.sensorId = sensor.id; // Store sensor DB ID

                             // Populate cells
                             newRow.insertCell().textContent = sensor.sensor_name || 'Unnamed Sensor';
                             const valueCell = newRow.insertCell(); valueCell.innerHTML = `<span class="value-display">${escapeHTML(String(lastReadingValue))}</span><input type="number" class="value-input" value="${lastReadingValue === 'N/A' ? '' : lastReadingValue}" style="display: none;">`;
                             const statusCell = newRow.insertCell(); statusCell.textContent = statusInfo.text; statusCell.className = statusInfo.class;
                             const actionCell = newRow.insertCell(); actionCell.innerHTML = `<button class="action-btn edit-btn" onclick="editSensor(this)">Edit</button><button class="action-btn remove-btn" onclick="removeSensor(this)">Remove</button>`;
                             sensorsPopulated = true;
                         });
                          if (sensorsPopulated && sensorTable) { updateOverallAirQuality(sensorTable); } // Update AQ if sensors were added

                     } else {
                          // API returned empty sensor array
                          sensorTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No sensors configured.</td></tr>';
                          if(sensorTable) updateOverallAirQuality(sensorTable); // Reset AQ
                     }
                 } else { console.warn("Sensor table body missing."); }

                 // --- Create/Update Chart ---
                 if(chartLoading) chartLoading.style.display = 'none';
                 if(canvas) canvas.style.display = ''; // Show chart area
                 console.log("Triggering chart creation/update...");
                  // Ensure sensors/readings are valid arrays/objects before passing
                 setTimeout(() => createSensorChart(binDbId, sensors || [], readings || {}), 50);

             } else { // result.success was false or result.data was missing
                 throw new Error(result.message || 'API reported failure or data missing.');
             }
         } catch (error) {
             // Handle errors during fetch or processing
              console.error(`Error handling details fetch for bin ${binDbId}:`, error);
              const mc = targetModal?.querySelector('.modal-content');
               if(mc) { // Display error inside modal
                  if(detailTableBody) detailTableBody.innerHTML += `<tr><td colspan="3" style="color:red;">${escapeHTML(error.message)}</td></tr>`;
                   if(sensorTableBody) sensorTableBody.innerHTML = '<tr><td colspan="4" style="color:red; text-align:center;">Error loading sensors.</td></tr>';
               }
               if(chartLoading) chartLoading.style.display = 'none'; // Hide loading indicator on error
         } finally {
              console.log(`Finished processing hash change for #bin-${binDbId}-modal`);
         }

    // --- Handle OTHER Modals ---
    } else if (hash === '#deleted-bins-modal') {
        const targetModal = document.getElementById('deleted-bins-modal');
        if (targetModal) {
            targetModal.style.display = 'block'; header.style.display = 'none'; footer.style.display = 'none';
            updateDeletedBinsView(); // Fetch and update deleted bins list
            currentModalBinId = null;
        }
    } else if (hash === '#map-modal') {
         const targetModal = document.getElementById('map-modal');
         if (targetModal) {
             targetModal.style.display = 'block'; header.style.display = 'none'; footer.style.display = 'none';
             if(mapInstance) setTimeout(() => mapInstance.invalidateSize(), 100); // Resize map if already initialized
             // Map markers are loaded by handleViewMap, often triggered by button click
             currentModalBinId = null;
         }
    } else { // No valid modal hash, ensure default state
         header.style.display = ''; footer.style.display = '';
         currentModalBinId = null;
    }
})
if (contactForm) {
    contactForm.addEventListener('submit', handleContactSubmit); // Attach the handler
} else { console.warn("Contact form (#contact-form) not found."); }; // ==== END: hashchange listener ====


/* ====================================== */
/* === Initial Page Load Logic === */
/* ====================================== */

/**
 * Fetches initial active bins and populates the grid.
 */
async function loadInitialBins() {
    console.log("Loading initial bins...");
    if (!binsGrid) { console.error("Bin grid container not found!"); return; }
    binsGrid.innerHTML = '<p style="text-align:center; width: 100%; color: #555;">Loading bins...</p>';

    try {
        const response = await fetch(`${API_URL}?action=get_bins`);
        console.log("Fetch Status (get_bins):", response.status, response.statusText);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        console.log("Parsed Result (get_bins):", result);

        binsGrid.innerHTML = ''; // Clear loading message only after successful fetch

        if (result.success && result.data && Array.isArray(result.data)) {
            if (result.data.length > 0) {
                console.log(`Found ${result.data.length} active bins. Creating elements...`);
                result.data.forEach(binDataFromApi => {
                     // Map keys correctly for createBinElements
                     const binDataForElement = {
                         id: binDataFromApi.id,
                         bin_identifier: binDataFromApi.bin_identifier,
                         location: binDataFromApi.location,
                         status: binDataFromApi.status,
                         // Include these if PHP 'get_bins' returns them & createBinElements uses them for initial state
                         // last_maintenance: binDataFromApi.last_maintenance,
                         // air_quality_status: binDataFromApi.air_quality_status
                     };
                    try {
                        const { card, modal } = createBinElements(binDataForElement);
                        binsGrid.appendChild(card);
                        document.body.appendChild(modal); // Add modal shell to DOM
                        addModalCloseListeners(modal);    // Attach close listeners
                    } catch(elementError) { console.error(`Element creation error bin ID ${binDataFromApi.id}:`, elementError); }
                });
            } else {
                console.log("API success, but no active bins found.");
                binsGrid.innerHTML = '<p style="text-align:center; width: 100%;">No active bins found.</p>';
            }
        } else { throw new Error(result.message || 'API reported failure or invalid data format.'); }
    } catch (error) {
        console.error("Fetch/Parse error loading initial bins:", error);
        binsGrid.innerHTML = `<p style="text-align:center; width: 100%; color: red;">Could not fetch bins. Error: ${escapeHTML(error.message)}</p>`;
    }

    // Check initial hash AFTER attempting to load bins
    setTimeout(() => {
        const currentHash = window.location.hash;
        if (currentHash.startsWith('#bin-') || ['#map-modal', '#deleted-bins-modal'].includes(currentHash)) {
             console.log("Initial hash detected post-load, dispatching hashchange:", currentHash);
             window.dispatchEvent(new HashChangeEvent('hashchange')); // Trigger listener to process hash
             // If initial hash is map, explicitly trigger map *logic* too
             if (currentHash === '#map-modal' && !mapInstance) { // Avoid re-triggering if already handled by button
                handleViewMap();
             }
        }
    }, 150); // Slight delay
}
document.addEventListener('DOMContentLoaded', loadInitialBins);


/* ====================================== */
/* === Initial Page Load Logic === */
/* ====================================== */
/**
 * Fetches initial active bins and populates the grid.
 */
 async function loadInitialBins() {
      console.log("Loading initial bins...");
      if (binsGrid) {
          binsGrid.innerHTML = '<p style="text-align:center; width: 100%; color: #555;">Loading bins...</p>';
      } else { console.error("Bin grid container not found!"); return; }
      try {
          const response = await fetch(`${API_URL}?action=get_bins`);
          console.log("Fetch Response Status (get_bins):", response.status, response.statusText);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const result = await response.json();
          console.log("Parsed Result (get_bins):", result);

          if (binsGrid) binsGrid.innerHTML = ''; // Clear loading message

          if (result.success && result.data && Array.isArray(result.data)) {
              if (result.data.length > 0) {
                   console.log(`Found ${result.data.length} active bins. Creating elements...`);
                  result.data.forEach(binDataFromApi => {
                       const binDataForElement = {
                           id: binDataFromApi.id,
                           bin_identifier: binDataFromApi.bin_identifier,
                           location: binDataFromApi.location,
                           status: binDataFromApi.status
                       };
                      try {
                          const { card, modal } = createBinElements(binDataForElement);
                          binsGrid.appendChild(card);
                          document.body.appendChild(modal);
                          addModalCloseListeners(modal);
                      } catch(elementError) { console.error(`Error creating elements for bin ID ${binDataFromApi.id}:`, elementError); }
                  });
              } else {
                   console.log("API success, but no active bins found in data array.");
                   if (binsGrid) binsGrid.innerHTML = '<p style="text-align:center; width: 100%;">No active bins found.</p>';
              }
          } else if (result.success) {
              console.warn("API success flag true, but 'data' was missing or not an array:", result);
              if (binsGrid) binsGrid.innerHTML = '<p style="text-align:center; width: 100%;">No active bins found (unexpected data format).</p>';
          } else {
              console.error("API Error loading bins:", result.message || 'Unknown API error');
              if (binsGrid) binsGrid.innerHTML = `<p style="text-align:center; width: 100%; color: red;">Error loading bins: ${escapeHTML(result.message || 'Unknown API error')}</p>`;
          }
      } catch (error) {
          console.error("Fetch/Parse error loading initial bins:", error);
          if (binsGrid) binsGrid.innerHTML = `<p style="text-align:center; width: 100%; color: red;">Could not fetch bins. Check console and ensure backend is running.</p>`;
      }

      setTimeout(() => { // Check initial hash AFTER bins load attempt
          const currentHash = window.location.hash;
          if (currentHash.startsWith('#bin-') || currentHash === '#map-modal' || currentHash === '#deleted-bins-modal') {
               console.log("Initial hash detected, dispatching hashchange:", currentHash);
               window.dispatchEvent(new HashChangeEvent('hashchange')); // Trigger listener
               if (currentHash === '#map-modal') handleViewMap(); // Special case for map
          }
      }, 150);
  }
  document.addEventListener('DOMContentLoaded', loadInitialBins); // Corrected listener attach

 console.log("FAIRLTER Script Initialized (DB Version)"); // Final log