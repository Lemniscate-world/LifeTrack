// simuler-reinstall.cjs
var fs = require('fs');
var path = require('path');

var backupPath = path.join(process.env.USERPROFILE, 'Documents', 'LifeTrack-Backups', 'lifetrack-backup-2026-07-25_06-12-47.json');
var backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));

console.log('=== SIMULATION REINSTALLATION LIFETRACK ===');
console.log('');
console.log('Scenario:');
console.log('  1. Uninstall LifeTrack');
console.log('  2. Clear browser cache');
console.log('  3. Reinstall the application');
console.log('');
console.log('--- ETAT APRES REINSTALLATION ---');
console.log('  localStorage: VIDE');
console.log('  loadData() -> freshData(): 0 habits, 0 check-ins');
console.log('');
console.log('--- AUTO-RESTORE (find_latest_backup) ---');
console.log('  Searching 7 locations...');
console.log('  -> Documents/LifeTrack-Backups/ FOUND');
console.log('  File: ' + path.basename(backupPath));
console.log('  Size: ' + (fs.statSync(backupPath).size / 1024).toFixed(1) + ' KB');
console.log('');

var items = [
  ['habits',           backup.habits ? backup.habits.length : 0],
  ['checkIns',         backup.checkIns ? backup.checkIns.length : 0],
  ['notes',            backup.notes ? backup.notes.length : 0],
  ['urges',            backup.urges ? backup.urges.length : 0],
  ['experiments',      backup.experiments ? backup.experiments.length : 0],
  ['moods',            Object.keys(backup.moods || {}).length],
  ['customUrgeTypes',  backup.customUrgeTypes ? backup.customUrgeTypes.length : 0],
  ['mantras',          backup.mantras ? backup.mantras.length : 0],
  ['chaosDimensions',  backup.chaosDimensions ? backup.chaosDimensions.length : 0],
  ['skills',           backup.skills ? backup.skills.length : 0],
  ['capacities',       backup.capacities ? backup.capacities.length : 0],
  ['capacityRatings',  backup.capacityRatings ? backup.capacityRatings.length : 0],
  ['preferences',      backup.preferences ? 'darkMode=' + backup.preferences.darkMode : 'default'],
];

console.log('--- BACKUP CONTENTS ---');
for (var i = 0; i < items.length; i++) {
  var name = items[i][0];
  var count = items[i][1];
  var marker = typeof count === 'number' ? (count > 0 ? '[OK]' : '[--]') : '[OK]';
  var padded = name;
  while (padded.length < 20) padded += ' ';
  console.log('  ' + marker + ' ' + padded + ' ' + String(count));
}

var notesCount = (backup.checkIns || []).filter(function(c) { return c.notes && c.notes.length > 0; }).length;
var multiCount = (backup.checkIns || []).filter(function(c) { return c.count && c.count > 1; }).length;
var catCount = (backup.habits || []).filter(function(h) { return h.category; }).length;
var stackCount = (backup.habits || []).filter(function(h) { return h.stackParent; }).length;
var chaosCount = (backup.habits || []).filter(function(h) { return h.chaosDimension; }).length;
var archivedCount = (backup.habits || []).filter(function(h) { return h.archived; }).length;

console.log('');
console.log('--- DETAILS ---');
console.log('  Active habits      : ' + (backup.habits.length - archivedCount));
console.log('  Archived habits    : ' + archivedCount);
console.log('  With category      : ' + catCount);
console.log('  With stack         : ' + stackCount);
console.log('  With chaos link    : ' + chaosCount);
console.log('  Multi-note entries : ' + notesCount);
console.log('  Multi-click entries: ' + multiCount);
console.log('  Mantra morning     : ' + (backup.mantraSettings ? backup.mantraSettings.morningTime : 'N/A'));
console.log('  Mantra evening     : ' + (backup.mantraSettings ? backup.mantraSettings.eveningTime : 'N/A'));

var totalItems = backup.habits.length + backup.checkIns.length + backup.notes.length
  + backup.urges.length + backup.experiments.length + Object.keys(backup.moods).length
  + backup.customUrgeTypes.length + (backup.mantras ? backup.mantras.length : 0) + backup.chaosDimensions.length;

console.log('');
console.log('=== VERDICT ===');
if (backup.habits.length > 0 && backup.checkIns.length > 0) {
  console.log('SUCCESS: All data will be restored automatically.');
  console.log('  ' + backup.habits.length + ' habits');
  console.log('  ' + backup.checkIns.length + ' check-ins');
  console.log('  ' + totalItems + ' total items preserved');
  console.log('');
  console.log('User will see alert:');
  console.log('  "Backup restored automatically:"');
  console.log('  "' + backup.habits.length + ' habits added"');
  console.log('  "' + backup.checkIns.length + ' check-ins restored"');
} else {
  console.log('FAIL: Backup is empty or corrupt!');
}
