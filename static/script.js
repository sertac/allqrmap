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

// Modal & UI Elements
const modal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const aiBtn = document.getElementById('ai-btn');
const closeBtn = document.querySelector('.close');
const addForm = document.getElementById('add-form');
const latInput = document.getElementById('res-lat');
const lngInput = document.getElementById('res-lng');
const searchInput = document.getElementById('search-input');
const suggestionsList = document.getElementById('search-suggestions');
const radiusSlider = document.getElementById('radius-slider');
const radiusLabel = document.getElementById('radius-label');
let userLat = null;
let userLon = null;
let currentRadius = 5;
let radiusCircle = null;

// 1. Geolocation on startup
function centerOnUser() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            userLat = latitude;
            userLon = longitude;
            map.setView([latitude, longitude], 14);
            if (radiusCircle) map.removeLayer(radiusCircle);
            radiusCircle = L.circle([latitude, longitude], {
                radius: currentRadius * 1000,
                color: "#007bff",
                weight: 2,
                opacity: 0.6,
                fillColor: "#007bff",
                fillOpacity: 0.1
            }).addTo(map);
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

radiusSlider.addEventListener('input', () => {
    currentRadius = parseInt(radiusSlider.value);
    radiusLabel.textContent = `📍 ${currentRadius} km`;
    if (radiusCircle && userLat !== null && userLon !== null) {
        radiusCircle.setRadius(currentRadius * 1000);
    }
});

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

// Show/Hide suggestions
searchInput.addEventListener('focus', () => {
    suggestionsList.style.display = 'block';
});

// Hide suggestions when clicking outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('search-container');
    if (container && !container.contains(e.target)) {
        suggestionsList.style.display = 'none';
    }
});

// Handle suggestion clicks
document.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
        // Remove emoji and trim for the search
        const text = item.textContent.replace(/[\u{1F300}-\u{1F9FF}]/u, '').trim();
        searchInput.value = text;
        suggestionsList.style.display = 'none';
        aiBtn.onclick(); // Trigger AI search
    });
});

// Basic Search
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    
    if (term.length > 0) {
        suggestionsList.style.display = 'none'; // Hide suggestions while typing
    } else {
        suggestionsList.style.display = 'block'; // Show if empty again
    }

    if (term.length === 0) {
        allMarkers.forEach(item => { if (!map.hasLayer(item.marker)) item.marker.addTo(map); });
        return;
    }
    
    allMarkers.forEach(item => {
        if (item.restaurant.name.toLowerCase().includes(term)) {
            if (!map.hasLayer(item.marker)) item.marker.addTo(map);
        } else {
            if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
        }
    });
});

// AI Search
aiBtn.onclick = async () => {
    const query = searchInput.value;
    if (query.length < 3) {
        alert("Please enter a longer query for AI search!");
        return;
    }

    aiBtn.classList.add('loading');
    try {
        const body = { query };
        if (userLat !== null && userLon !== null) {
            body.user_lat = userLat;
            body.user_lon = userLon;
            body.radius = currentRadius;
        }
        const response = await fetch('/api/ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (response.ok) {
            const matchingIds = await response.json();
            
            // Filter markers based on AI response
            allMarkers.forEach(item => {
                if (matchingIds.includes(item.restaurant.id)) {
                    if (!map.hasLayer(item.marker)) item.marker.addTo(map);
                } else {
                    if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
                }
            });

            if (matchingIds.length > 0) {
                // Zoom to fit matching markers
                const group = L.featureGroup(allMarkers.filter(m => matchingIds.includes(m.restaurant.id)).map(m => m.marker));
                map.fitBounds(group.getBounds().pad(0.5));
            } else {
                alert("AI couldn't find any matching restaurants.");
            }
        } else {
            const error = await response.text();
            alert("AI Search error: " + error);
        }
    } catch (err) {
        console.error(err);
        alert("AI Search network error.");
    } finally {
        aiBtn.classList.remove('loading');
    }
}

// Support 'Enter' key for AI search if text is long
searchInput.onkeypress = (e) => {
    if (e.key === 'Enter' && searchInput.value.split(' ').length > 2) {
        aiBtn.onclick();
    }
}

// Modal & Mini Map Logic
addBtn.onclick = () => {
    modal.style.display = "block";
    if (!miniMap) {
        miniMap = L.map('mini-map', { zoomControl: false }).setView(map.getCenter(), 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);
        miniMap.on('click', (e) => updateMiniMapMarker(e.latlng));
    } else {
        miniMap.setView(map.getCenter(), 15);
        miniMap.invalidateSize();
    }
    latInput.value = ""; lngInput.value = "";
    if (miniMapMarker) { miniMap.removeLayer(miniMapMarker); miniMapMarker = null; }
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

closeBtn.onclick = () => modal.style.display = "none";
window.onclick = (event) => { if (event.target == modal) closeBtn.onclick(); }

addForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!latInput.value || !lngInput.value) { alert("Please select a location on the mini-map!"); return; }
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
        } else { alert("Error adding restaurant."); }
    } catch (err) { console.error(err); alert("Network error."); }
}

centerOnUser();
fetchRestaurants();
