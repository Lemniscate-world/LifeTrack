const fs = require('fs');
const path = require('path');

const dir = path.join(process.env.LOCALAPPDATA, 'com.lemniscate.lifetrack', 'EBWebView', 'Default', 'Local Storage', 'leveldb');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ldb')).sort().reverse();

let found = false;
for (const f of files) {
  if (found) break;
  const buf = fs.readFileSync(path.join(dir, f));
  const str = buf.toString('latin1');
  
  // Find lifetrack-data-backup
  let idx = 0;
  while ((idx = str.indexOf('lifetrack-data-backup', idx)) !== -1) {
    const after = str.substring(idx + 22); // skip 'lifetrack-data-backup'
    // LevelDB value: [varint length][value bytes]
    // Look for { after skipping some binary
    const jsonStart = after.indexOf('{"v":1');
    if (jsonStart === -1) { idx++; continue; }
    
    const jsonCandidate = after.substring(jsonStart);
    // Parse the JSON by counting braces
    let depth = 0, end = 0, inStr = false, esc = false;
    for (let i = 0; i < jsonCandidate.length; i++) {
      const ch = jsonCandidate[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    
    if (end > 50) {
      const raw = jsonCandidate.substring(0, end);
      try {
        const parsed = JSON.parse(raw);
        if (parsed.v === 1 && parsed.d && Array.isArray(parsed.d.habits)) {
          console.log('FOUND valid backup in', f);
          console.log('Habits:', parsed.d.habits.length);
          console.log('Check-ins:', parsed.d.checkIns?.length || 0);
          console.log('Skills:', parsed.d.skills?.length || 0);
          
          // Save to Desktop
          const outPath = path.join(process.env.USERPROFILE, 'Desktop', 'lifetrack-backup-recovered.json');
          fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
          console.log('SAVED to', outPath);
          found = true;
          break;
        }
      } catch (e) {
        console.log('Parse error at', f, 'offset', idx, ':', e.message.substring(0, 80));
      }
    }
    idx++;
  }
}
if (!found) console.log('No valid backup found');
