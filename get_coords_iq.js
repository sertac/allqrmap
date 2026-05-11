const fs = require('fs');
const https = require('https');

const restaurants = JSON.parse(fs.readFileSync('verified_restaurants.json', 'utf8')).restaurants;

const CONCURRENCY = 50;
const API_KEY = 'demo';
const TEMP_FILE = 'verified_restaurants.json';

function getCoordsLocationIQ(name) {
  return new Promise(resolve => {
    const query = encodeURIComponent(`${name}, Istanbul, Turkey`);
    const url = `https://us1.locationiq.com/v1/search.php?key=${API_KEY}&q=${query}&format=json&limit=1`;
    
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json[0] && json[0].lat) {
            resolve({ lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) });
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

async function runBatch(batch) {
  const promises = batch.map(async (r) => {
    if (r.lat && r.lng) return r;
    
    const coords = await getCoordsLocationIQ(r.name);
    if (coords) return { ...r, lat: coords.lat, lng: coords.lon };
    return r;
  });
  return Promise.all(promises);
}

async function process() {
  console.log(`Processing ${restaurants.length} restaurants...`);
  
  const needCoords = restaurants.filter(r => !(r.lat && r.lng));
  console.log(`Need: ${needCoords.length}`);
  
  let results = [...restaurants];
  let done = 0;
  
  for (let i = 0; i < results.length; i += CONCURRENCY) {
    const batch = results.slice(i, i + CONCURRENCY);
    const batchResults = await runBatch(batch);
    
    for (let j = 0; j < batch.length; j++) {
      results[i + j] = batchResults[j];
      if (batchResults[j].lat && !batch[j].lat) {
        console.log(`✓ ${batchResults[j].name}: ${batchResults[j].lat}, ${batchResults[j].lng}`);
      }
    }
    
    done += batch.length;
    console.log(`Progress: ${done}/${results.length}`);
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  const withCoords = results.filter(r => r.lat);
  console.log(`\n=== DONE: ${withCoords.length}/${results.length} with coords ===`);
  
  fs.writeFileSync(TEMP_FILE, JSON.stringify({ restaurants: results }, null, 2));
}

process();