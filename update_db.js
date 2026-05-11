const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('restaurants.db');

const updates = [
  { name: 'Agora Restaurant & Meyhane', menu_url: 'https://agora1890.com/menu_v2/', lat: 41.0547, lng: 28.9435, adres: 'Mürselpaşa Cd. No:185, Balat, Fatih' },
];

db.serialize(() => {
  const stmt = db.prepare("UPDATE restaurants SET menu_url = ?, lat = ?, lng = ? WHERE name = ?");
  updates.forEach(u => {
    stmt.run(u.menu_url, u.lat, u.lng, u.name, (err) => {
      if (err) console.log('Error:', err.message);
      else console.log(`✓ ${u.name}`);
    });
  });
  stmt.finalize(() => { db.close(); });
});