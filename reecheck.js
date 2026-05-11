const https = require('https');
const http = require('http');
const fs = require('fs');

const broken = JSON.parse(fs.readFileSync('broken_links.json', 'utf8'));
const toCheck = broken.filter(b => 
  String(b.status).includes('Timeout') || 
  b.status === 403 ||
  String(b.status).includes('socket')
);

console.log(`Checking ${toCheck.length} links...`);

let fixed = [];
let checked = 0;

async function check(url) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol === 'https:' ? https : http;
      
      const req = protocol.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        timeout: 10000,
        rejectUnauthorized: false
      }, (res) => {
        resolve(res.statusCode);
      });
      
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.end();
    } catch(e) { resolve(0); }
  });
}

async function run() {
  for (const item of toCheck) {
    checked++;
    const status = await check(item.url);
    
    if (status >= 200 && status < 400) {
      console.log(`✓ [${checked}/${toCheck.length}] ${item.name}: ${status} - WORKS!`);
      fixed.push({ ...item, newUrl: item.url, newStatus: status });
    } else {
      console.log(`  [${checked}/${toCheck.length}] ${item.name}: ${status || 'error'}`);
    }
    
    if (checked % 20 === 0) {
      console.log(`Progress: ${checked}/${toCheck.length}`);
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\n=== DONE ===`);
  console.log(`Fixed: ${fixed.length}`);
  fs.writeFileSync('reechecked.json', JSON.stringify(fixed, null, 2));
}

run();