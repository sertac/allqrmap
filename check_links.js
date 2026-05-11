const sqlite3 = require('sqlite3').verbose();
const https = require('https');
const http = require('http');

const db = new sqlite3.Database('restaurants.db');
const MAX_CONCURRENT = 10;
let checked = 0;
let broken = [];
let total = 0;

// Get all URLs from database
db.all("SELECT id, name, menu_url FROM restaurants WHERE menu_url IS NOT NULL", [], (err, rows) => {
  if (err) { console.error(err); db.close(); return; }
  
  total = rows.length;
  console.log(`Checking ${total} URLs...`);
  
  const checkQueue = [...rows];
  let active = 0;
  
  function checkNext() {
    while (active < MAX_CONCURRENT && checkQueue.length > 0) {
      const row = checkQueue.shift();
      active++;
      checkURL(row.id, row.name, row.menu_url);
    }
  }
  
  function checkURL(id, name, url) {
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;
    
    const req = protocol.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'HEAD',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AllQRBot/1.0)',
        'Accept': '*/*'
      }
    }, (res) => {
      active--;
      checked++;
      
      if (res.statusCode >= 400) {
        broken.push({ id, name, url, status: res.statusCode });
        console.log(`❌ [${checked}/${total}] ${name}: ${res.statusCode}`);
      } else if (checked % 100 === 0) {
        console.log(`✓ Checked ${checked}/${total}`);
      }
      
      if (checkQueue.length > 0 || active > 0) setTimeout(checkNext, 50);
      else finish();
    });
    
    req.on('error', (e) => {
      active--;
      broken.push({ id, name, url, status: 'ERR: ' + e.message});
      console.log(`❌ [${checked}/${total}] ${name}: ${e.message}`);
      
      if (checkQueue.length > 0 || active > 0) setTimeout(checkNext, 50);
      else finish();
    });
    
    req.on('timeout', () => {
      req.destroy();
      active--;
      broken.push({ id, name, url, status: 'TIMEOUT'});
      console.log(`⏱️ [${checked}/${total}] ${name}: Timeout`);
      
      if (checkQueue.length > 0 || active > 0) setTimeout(checkNext, 50);
      else finish();
    });
    
    req.end();
  }
  
  function finish() {
    console.log(`\n=== DONE ===`);
    console.log(`Total checked: ${total}`);
    console.log(`Broken links: ${broken.length}`);
    
    // Save broken links to file
    const fs = require('fs');
    fs.writeFileSync('broken_links.json', JSON.stringify(broken, null, 2));
    console.log('Saved to broken_links.json');
    
    // Update database with broken status
    const stmt = db.prepare("UPDATE restaurants SET menu_url = ? WHERE id = ?");
    broken.forEach(b => {
      stmt.run(b.status === 404 ? null : b.url + ' [' + b.status + ']', b.id);
    });
    stmt.finalize(() => {
      console.log('Updated database');
      db.close();
    });
  }
  
  checkNext();
});