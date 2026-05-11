const https = require('https');
const http = require('http');
const fs = require('fs');

const broken = JSON.parse(fs.readFileSync('broken_links.json', 'utf8'));
const f404 = broken.filter(b => b.status === 404);
console.log(`Found ${f404.length} 404 links to fix`);

const searchCache = {};

async function searchMenu(restaurantName) {
  const cacheKey = restaurantName.toLowerCase();
  if (searchCache[cacheKey]) return searchCache[cacheKey];
  
  return new Promise(resolve => {
    const query = encodeURIComponent(`${restaurantName} Istanbul menu`);
    const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://duckduckgo.com/html/?q=${query}`)}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const match = data.match(/https?:\/\/[^\s"'<>]+\/(menu|menü)/i);
        if (match) {
          searchCache[cacheKey] = match[0];
          resolve(match[0]);
        } else {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

async function checkLink(url) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol === 'https:' ? https : http;
      
      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        timeout: 8000
      }, (res) => {
        resolve({ status: res.statusCode, working: res.statusCode < 400 });
      });
      
      req.on('error', () => resolve({ status: 'ERR', working: false }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', working: false }); });
      req.end();
    } catch(e) {
      resolve({ status: 'ERR', working: false });
    }
  });
}

async function processBatch() {
  const results = [];
  
  for (let i = 0; i < f404.length; i++) {
    const item = f404[i];
    console.log(`[${i+1}/${f404.length}] Checking ${item.name}...`);
    
    const check = await checkLink(item.url);
    if (check.working) {
      console.log(`  ✓ Link works now: ${check.status}`);
      results.push({ ...item, newUrl: item.url, fixed: true });
      continue;
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  fs.writeFileSync('auto_fixed.json', JSON.stringify(results, null, 2));
  console.log('Done! Results saved to auto_fixed.json');
}

processBatch();