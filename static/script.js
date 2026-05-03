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
    });
}

// Search functionality
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = restaurantsData.filter(r => 
        r.name.toLowerCase().includes(term)
    );
    
    // Filter markers visibility
    allMarkers.forEach(item => {
        if (item.restaurant.name.toLowerCase().includes(term)) {
            if (!map.hasLayer(item.marker)) {
                item.marker.addTo(map);
            }
        } else {
            if (map.hasLayer(item.marker)) {
                map.removeLayer(item.marker);
            }
        }
    });

    // If there's a unique match, center on it
    if (filtered.length === 1 && term.length > 2) {
        map.panTo([filtered[0].lat, filtered[0].lng]);
    }
});

fetchRestaurants();
