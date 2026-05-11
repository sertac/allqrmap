const fs = require('fs');
const https = require('https');

const INPUT = 'verified_kalan.json';
const CACHE_FILE = 'coords_cache.json';
const DELAY_MS = 1200;
const SAVE_EVERY = 5 * 60 * 1000;

let coordCache = {};
try {
    coordCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch(e) {}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(coordCache, null, 2));
}

function getTimestamp() {
    return new Date().toISOString().slice(0,19).replace(/:/g,'-');
}

function isTurkey(lat, lon) {
    return lat >= 35.0 && lat <= 42.0 && lon >= 25.0 && lon <= 45.0;
}

function getCoords(name) {
    if (coordCache[name]) return Promise.resolve(coordCache[name]);
    
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
                        
                        if (isTurkey(lat, lon)) {
                            const result = { lat, lon };
                            coordCache[name] = result;
                            console.log(`✓ ${name}: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
                            resolve(result);
                        } else {
                            console.log(`✗ ${name}: dışarıda (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
                            resolve(null);
                        }
                    } else {
                        console.log(`✗ ${name}: bulunamadı`);
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
    let data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
    let restaurants = data.restaurants;
    const total = restaurants.length;
    
    // Count already have Turkey coords in this file
    let already = restaurants.filter(r => r.lat && r.lat != 0 && isTurkey(r.lat, r.lng));
    let found = already.length;
    let processed = found;
    let lastSave = Date.now();
    
    console.log(`KALAN: ${total} restoran - ${found} zaten var`);
    console.log(`Cache: ${Object.keys(coordCache).length}`);
    
    for (let i = 0; i < total; i++) {
        const r = restaurants[i];
        
        // Skip if already has Turkey coords
        if (r.lat && r.lat != 0 && isTurkey(r.lat, r.lng)) continue;
        
        // Check cache
        if (coordCache[r.name]) {
            const c = coordCache[r.name];
            if (isTurkey(c.lat, c.lon)) {
                r.lat = c.lat;
                r.lng = c.lon;
                found++;
            }
        } else {
            const coords = await getCoords(r.name);
            if (coords) {
                r.lat = coords.lat;
                r.lng = coords.lon;
                found++;
            }
        }
        
        processed++;
        if (processed % 25 === 0 && processed > found) {
            console.log(`İlerleme: ${processed}/${total} - Türkiye: ${found}`);
        }
        
        // Save every 5 minutes
        if (Date.now() - lastSave > SAVE_EVERY) {
            saveCache();
            const ts = getTimestamp();
            fs.writeFileSync(INPUT, JSON.stringify({ restaurants }, null, 2));
            console.log(`[${ts}] Kaydedildi: ${found} koordinat`);
            lastSave = Date.now();
        }
        
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    
    saveCache();
    fs.writeFileSync(INPUT, JSON.stringify({ restaurants }, null, 2));
    console.log(`\n=== BİTTİ: ${found} Türkiye koordinat ===`);
}

process();