// test-ollama.cjs
var http = require('http');

var fs = require('fs');
var path = require('path');

var backupPath = path.join(process.env.USERPROFILE, 'Documents', 'LifeTrack-Backups', 'lifetrack-backup-2026-07-25_06-12-47.json');
var backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));

var summary = '';
backup.habits.filter(function(h) { return !h.archived; }).forEach(function(h) {
  var completed = backup.checkIns.filter(function(ci) { return ci.habitId === h.id && ci.completed; }).length;
  var total = backup.checkIns.filter(function(ci) { return ci.habitId === h.id; }).length;
  var rate = total > 0 ? Math.round(completed / total * 100) : 0;
  var stack = h.stackParent ? 'after: ' + (backup.habits.find(function(p) { return p.id === h.stackParent; }) || {}).name : 'none';
  summary += h.name + ': ' + completed + '/' + total + ' done (' + rate + '%), best streak ' + (h.bestStreak || 0) + ', stack ' + stack + '\n';
});

console.log('Summary: ' + summary.length + ' chars');
console.log(summary);

var body = JSON.stringify({
  model: 'minimax-m3:cloud',
  prompt: 'You are a kind, supportive habit coach. Analyze the following habit data and give 3-5 concise, actionable insights. Focus on: patterns, correlations, suggestions for habit stacking, and motivational observations. Be warm but direct. Use bullet points. No markdown headers. Max 200 words.\n\nHABIT DATA (anonymized):\n' + summary,
  stream: false,
  options: { temperature: 0.7, num_predict: 300 }
});

console.log('Sending to Ollama...');

var req = http.request({
  hostname: 'localhost',
  port: 11434,
  path: '/api/generate',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  timeout: 60000
}, function(res) {
  var data = '';
  res.on('data', function(chunk) { data += chunk; });
  res.on('end', function() {
    var resp = JSON.parse(data);
    console.log('\n=== OLLAMA RESPONSE ===');
    console.log(resp.response);
  });
});

req.on('error', function(e) { console.error('Ollama error:', e.message); });
req.write(body);
req.end();
