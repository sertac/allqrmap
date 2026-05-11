const fs = require('fs');
const https = require('https');

const restaurants = JSON.parse(fs.readFileSync('verified_restaurants.json', 'utf8')).restaurants;

const CONCURRENCY = 100;
const DELAY_BETWEEN = 2000;
const TEMP_FILE = 'verified_restaurants.json';

function getCoords(name) {
  return new Promise(resolve => {
    const query = encodeURIComponent(`${name}, Istanbul, Turkey`);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
    
    const req = https.get(url, {
      headers: { 'User-Agent': 'AllQRBot/1.0' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.length > 0) {
            resolve({ lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon), display: json[0].display_name });
          } else {
            resolve(null);
          }
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

async function runBatch(start, batch) {
  const promises = batch.map(async (r, i) => {
    if (r.lat && r.lng) {
      return { ...r, idx: start + i };
    }
    
    const coords = await getCoords(r.name);
    if (coords) {
      return { ...r, lat: coords.lat, lng: coords.lon, address: coords.display };
    }
    return r;
  });
  
  return Promise.all(promises);
}

async function process() {
  console.log(`Starting ${restaurants.length} restaurants with ${CONCURRENCY} concurrent requests...`);
  
  let results = [];
  let processed = 0;
  
  const existing = restaurants.filter(r => r.lat && r.lng);
  results = [...existing];
  processed = existing.length;
  console.log(`Already have coords: ${existing.length}`);
  
  const pending = restaurants.filter(r => !(r.lat && r.lng));
  console.log(`Need to process: ${pending.length}\n`);
  
  let batchNum = 0;
  while (processed < restaurants.length) {
    batchNum++;
    const start = results.length;
    const batch = pending.slice(start, start + CONCURRENCY);
    
    if (batch.length === 0) break;
    
    console.log(`Batch ${batchNum}: processing ${batch.length} restaurants...`);
    const batchResults = await runBatch(start, batch);
    
    for (const r of batchResults) {
      results.push(r);
      if (r.lat) {
        console.log(`✓ ${r.name}: ${r.lat}, ${r.lng}`);
      }
    }
    
    processed = results.length;
    console.log(`Progress: ${processed}/${restaurants.length} (${Math.round(processed/restaurants.length*100)}%)\n`);
    
    if (batch.length === CONCURRENCY) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN));
    }
  }
  
  console.log('\n=== DONE ===');
  const withCoords = results.filter(r => r.lat);
  console.log(`Found coords for ${withCoords.length} restaurants`);
  
  fs.writeFileSync(TEMP_FILE, JSON.stringify({ restaurants: results }, null, 2));
  console.log(`Saved to ${TEMP_FILE}`);
}

process();