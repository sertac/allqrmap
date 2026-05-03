// Initialize the map centered on Istanbul
const map = L.map('map', {
    zoomControl: false 
}).setView([41.0082, 28.9784], 11);

L.control.zoom({
    position: 'bottomright'
}).addTo(map);

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let allMarkers = [];
let restaurantsData = [];
let tempMarker = null;

// Modal Elements
const modal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const closeBtn = document.querySelector('.close');
const addForm = document.getElementById('add-form');
const latInput = document.getElementById('res-lat');
const lngInput = document.getElementById('res-lng');

// Fetch restaurants from the API
async function fetchRestaurants() {
    try {
        const response = await fetch('/api/restaurants');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        restaurantsData = await response.json();
        renderMarkers(restaurantsData);
    } catch (error) {
        console.error('Could not fetch restaurants:', error);
    }
}

function renderMarkers(restaurants) {
    // Clear existing markers
    allMarkers.forEach(m => map.removeLayer(m.marker));
    allMarkers = [];

    restaurants.forEach(restaurant => {
        addMarkerToMap(restaurant);
    });
}

function addMarkerToMap(restaurant) {
    const marker = L.marker([restaurant.lat, restaurant.lng]).addTo(map);
    
    // Prepare popup content
    const popupDiv = document.createElement('div');
    popupDiv.className = 'popup-content';
    popupDiv.innerHTML = `
        <h3>${restaurant.name}</h3>
        <div id="qr-${restaurant.id}" class="qr-container"></div>
        <a href="${restaurant.menu_url}" target="_blank" class="menu-link">Open Menu</a>
    `;
    
    marker.bindPopup(popupDiv);

    // Generate QR code when popup opens
    marker.on('popupopen', () => {
        const qrElement = document.getElementById(`qr-${restaurant.id}`);
        if (qrElement && qrElement.innerHTML === "") {
            new QRCode(qrElement, {
                text: restaurant.menu_url,
                width: 128,
                height: 128,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }
    });

    allMarkers.push({
        restaurant,
        marker
    });
}

// Search functionality
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = restaurantsData.filter(r => 
        r.name.toLowerCase().includes(term)
    );
    
    allMarkers.forEach(item => {
        if (item.restaurant.name.toLowerCase().includes(term)) {
            if (!map.hasLayer(item.marker)) item.marker.addTo(map);
        } else {
            if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
        }
    });

    if (filtered.length === 1 && term.length > 2) {
        map.panTo([filtered[0].lat, filtered[0].lng]);
    }
});

// Modal Logic
addBtn.onclick = () => {
    modal.style.display = "block";
    // Set default coordinates to map center if empty
    if (!latInput.value) {
        const center = map.getCenter();
        latInput.value = center.lat.toFixed(6);
        lngInput.value = center.lng.toFixed(6);
    }
}

closeBtn.onclick = () => {
    modal.style.display = "none";
    if (tempMarker) {
        map.removeLayer(tempMarker);
        tempMarker = null;
    }
}

window.onclick = (event) => {
    if (event.target == modal) {
        closeBtn.onclick();
    }
}

// Map click to set location
map.on('click', (e) => {
    if (modal.style.display === "block") {
        latInput.value = e.latlng.lat.toFixed(6);
        lngInput.value = e.latlng.lng.toFixed(6);
        
        if (tempMarker) map.removeLayer(tempMarker);
        tempMarker = L.marker(e.latlng, { opacity: 0.6 }).addTo(map);
    }
});

// Form Submission
addForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('res-name').value;
    const menu_url = document.getElementById('res-menu').value;
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);

    try {
        const response = await fetch('/api/restaurants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, menu_url, lat, lng })
        });

        if (response.ok) {
            const newRes = await response.json();
            restaurantsData.push(newRes);
            addMarkerToMap(newRes);
            map.setView([lat, lng], 15);
            addForm.reset();
            closeBtn.onclick();
            alert("Restaurant added successfully!");
        } else {
            alert("Error adding restaurant.");
        }
    } catch (err) {
        console.error(err);
        alert("Network error.");
    }
}

fetchRestaurants();
