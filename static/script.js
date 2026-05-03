// Initialize the map centered on New York City
const map = L.map('map').setView([40.7306, -73.9352], 13);

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Fetch restaurants from the API
async function fetchRestaurants() {
    try {
        const response = await fetch('/api/restaurants');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const restaurants = await response.json();
        
        restaurants.forEach(restaurant => {
            const marker = L.marker([restaurant.lat, restaurant.lng]).addTo(map);
            
            const popupContent = `
                <div class="popup-content">
                    <h3>${restaurant.name}</h3>
                    <a href="${restaurant.menu_url}" target="_blank" class="menu-button">View QR Menu</a>
                </div>
            `;
            
            marker.bindPopup(popupContent);
        });
    } catch (error) {
        console.error('Could not fetch restaurants:', error);
    }
}

fetchRestaurants();
