const fs = require('fs');
const https = require('https');

const INPUT = 'all_restaurants.json';
const OUTPUT = 'verified_restaurants.json';
const DELAY_MS = 1200;
const SAVE_EVERY = 5 * 60 * 1000;
const CACHE_FILE = 'coords_cache.json';

let coordCache = {};
try {
    coordCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch(e) {}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(coordCache, null, 2));
}

function isIstanbul(lat, lon) {
    return lat >= 40.8 && lat <= 41.3 && lon >= 28.6 && lon <= 29.3;
}

function getCoords(name) {
    if (coordCache[name]) {
        const c = coordCache[name];
        if (isIstanbul(c.lat, c.lon)) {
            return Promise.resolve(c);
        }
    }
    
    return new Promise(resolve => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&limit=1&countryCodes=TR`;
        
        const req = https.get(url, {
            headers: { 'User-Agent': 'AllQRBot/1.0' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json && json.length > 0) {
                        const lat = parseFloat(json[0].lat);
                        const lon = parseFloat(json[0].lon);
                        
                        // ONLY accept Istanbul coordinates!
                        if (isIstanbul(lat, lon)) {
                            const result = { lat, lon };
                            coordCache[name] = result;
                            resolve(result);
                        } else {
                            console.log(`✗ ${name}: Not Istanbul (${lat}, ${lon})`);
                            resolve(null);
                        }
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

async function process() {
    let restaurants = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
    restaurants = restaurants.map((r, i) => ({...r, id: r.id || (i + 1)}));
    const total = restaurants.length;
    
    let processed = 0;
    let found = 0;
    
    const withCoords = restaurants.filter(r => r.lat && r.lat !== 0 && isIstanbul(r.lat, r.lng));
    processed = withCoords.length;
    found = withCoords.length;
    
    console.log(`Starting: ${withCoords.length}/${total} have Istanbul coords`);
    console.log(`Cache size: ${Object.keys(coordCache).length}`);
    
    fs.writeFileSync(OUTPUT, JSON.stringify({ restaurants }, null, 2));
    
    let lastSave = Date.now();
    
    for (let i = 0; i < total; i++) {
        const r = restaurants[i];
        
        if (r.lat && r.lat !== 0 && isIstanbul(r.lat, r.lng)) continue;
        
        if (coordCache[r.name]) {
            const c = coordCache[r.name];
            if (isIstanbul(c.lat, c.lon)) {
                r.lat = c.lat;
                r.lng = c.lon;
            }
        } else {
            const coords = await getCoords(r.name);
            if (coords) {
                r.lat = coords.lat;
                r.lng = coords.lon;
                found++;
                console.log(`✓ ${r.name}: ${coords.lat}, ${coords.lon}`);
            }
        }
        
        processed++;
        if (processed % 50 === 0) {
            console.log(`Progress: ${processed}/${total} (${Math.round(processed/total*100)}%) - Found: ${found}`);
        }
        
        if (Date.now() - lastSave > SAVE_EVERY) {
            fs.writeFileSync(OUTPUT, JSON.stringify({ restaurants }, null, 2));
            saveCache();
            const wc = restaurants.filter(x => x.lat && x.lat != 0 && isIstanbul(x.lat, x.lng)).length;
            console.log(`[Saved] ${wc} Istanbul coords`);
            lastSave = Date.now();
        }
        
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    
    fs.writeFileSync(OUTPUT, JSON.stringify({ restaurants }, null, 2));
    saveCache();
    console.log(`\n=== DONE: ${found} new Istanbul coords ===`);
}

process();