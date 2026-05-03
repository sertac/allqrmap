// Initialize the main map
const map = L.map('map', {
    zoomControl: false 
}).setView([41.0082, 28.9784], 11); // Fallback to Istanbul

L.control.zoom({
    position: 'bottomright'
}).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let allMarkers = [];
let restaurantsData = [];
let miniMap = null;
let miniMapMarker = null;

// Modal Elements
const modal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const closeBtn = document.querySelector('.close');
const addForm = document.getElementById('add-form');
const latInput = document.getElementById('res-lat');
const lngInput = document.getElementById('res-lng');

// 1. Geolocation on startup
function centerOnUser() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            map.setView([latitude, longitude], 14);
            
            // Add a "You are here" marker
            L.circleMarker([latitude, longitude], {
                radius: 8,
                fillColor: "#007bff",
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map).bindPopup("You are here").openPopup();
            
        }, (err) => {
            console.warn(`Geolocation error (${err.code}): ${err.message}`);
        }, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    }
}

// Fetch restaurants from the API
async function fetchRestaurants() {
    try {
        const response = await fetch('/api/restaurants');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        restaurantsData = await response.json();
        renderMarkers(restaurantsData);
    } catch (error) {
        console.error('Could not fetch restaurants:', error);
    }
}

function renderMarkers(restaurants) {
    allMarkers.forEach(m => map.removeLayer(m.marker));
    allMarkers = [];
    restaurants.forEach(addMarkerToMap);
}

function addMarkerToMap(restaurant) {
    const marker = L.marker([restaurant.lat, restaurant.lng]).addTo(map);
    const popupDiv = document.createElement('div');
    popupDiv.className = 'popup-content';
    popupDiv.innerHTML = `
        <h3>${restaurant.name}</h3>
        <div id="qr-${restaurant.id}" class="qr-container"></div>
        <a href="${restaurant.menu_url}" target="_blank" class="menu-link">Open Menu</a>
    `;
    marker.bindPopup(popupDiv);

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

    allMarkers.push({ restaurant, marker });
}

// Search
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = restaurantsData.filter(r => r.name.toLowerCase().includes(term));
    allMarkers.forEach(item => {
        if (item.restaurant.name.toLowerCase().includes(term)) {
            if (!map.hasLayer(item.marker)) item.marker.addTo(map);
        } else {
            if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
        }
    });
    if (filtered.length === 1 && term.length > 2) map.panTo([filtered[0].lat, filtered[0].lng]);
});

// Modal & Mini Map Logic
addBtn.onclick = () => {
    modal.style.display = "block";
    
    // Initialize or update mini map
    if (!miniMap) {
        miniMap = L.map('mini-map', { zoomControl: false }).setView(map.getCenter(), 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);
        
        miniMap.on('click', (e) => {
            updateMiniMapMarker(e.latlng);
        });
    } else {
        miniMap.setView(map.getCenter(), 15);
        miniMap.invalidateSize();
    }
    
    // Reset inputs
    latInput.value = "";
    lngInput.value = "";
    if (miniMapMarker) {
        miniMap.removeLayer(miniMapMarker);
        miniMapMarker = null;
    }
}

function updateMiniMapMarker(latlng) {
    latInput.value = latlng.lat.toFixed(6);
    lngInput.value = latlng.lng.toFixed(6);
    
    if (miniMapMarker) {
        miniMapMarker.setLatLng(latlng);
    } else {
        miniMapMarker = L.marker(latlng, { draggable: true }).addTo(miniMap);
        miniMapMarker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            latInput.value = pos.lat.toFixed(6);
            lngInput.value = pos.lng.toFixed(6);
        });
    }
}

closeBtn.onclick = () => {
    modal.style.display = "none";
}

window.onclick = (event) => {
    if (event.target == modal) closeBtn.onclick();
}

addForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!latInput.value || !lngInput.value) {
        alert("Please select a location on the mini-map!");
        return;
    }

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

// Initial calls
centerOnUser();
fetchRestaurants();
