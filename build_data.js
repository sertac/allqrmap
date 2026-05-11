const fs = require('fs');
const path = require('path');

const DB_FILE = 'restaurants.db';
const OUTPUT_FILE = 'static/data.js';

function getRestaurants() {
  const Database = require('better-sqlite3');
  const db = Database(DB_FILE);
  
  const rows = db.prepare(`
    SELECT id, name, lat, lng, menu_url 
    FROM restaurants 
    WHERE lat != 0 AND lng != 0
  `).all();
  
  db.close();
  return rows;
}

const restaurants = getRestaurants();
const js = `window.ALL_QR_DATA = ${JSON.stringify(restaurants)};`;

fs.writeFileSync(OUTPUT_FILE, js);
console.log(`Written ${restaurants.length} restaurants to ${OUTPUT_FILE}`);