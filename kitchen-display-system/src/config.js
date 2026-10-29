const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

function loadStations(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = new Set(raw.stations.map((s) => s.id));
  if (!ids.has(raw.defaultStation)) {
    throw new Error(`defaultStation "${raw.defaultStation}" δεν υπάρχει στα stations`);
  }
  for (const [cat, st] of Object.entries(raw.categoryRouting || {})) {
    if (!ids.has(st)) throw new Error(`Η κατηγορία "${cat}" δρομολογείται σε άγνωστο station "${st}"`);
  }
  return raw;
}

// trim: στο cmd των Windows το `set X=y && ...` αφήνει κενό στο τέλος της τιμής.
const env = (name, fallback = '') => (process.env[name] || fallback).trim();

// Όλα όσα αλλάζουν κατά τη λειτουργία (βάση, μενού, κλειδί) ζουν στον φάκελο δεδομένων,
// ώστε στο cloud να αρκεί ένας μόνιμος δίσκος (volume) σε αυτόν τον φάκελο.
const dataDir = path.resolve(env('KDS_DATA_DIR', path.join(ROOT, 'data')));

const config = {
  port: Number(env('PORT', '3000')),
  dataDir,
  dbFile: env('KDS_DB') || path.join(dataDir, 'kds.sqlite'),
  // Κλειδί που πρέπει να στέλνει το ERP (Authorization: Bearer <key> ή X-API-Key).
  erpApiKey: env('ERP_API_KEY'),
  // Πού στέλνει το KDS ενημερώσεις κατάστασης πίσω στο ERP (κενό = απενεργοποιημένο)
  erpWebhookUrl: env('ERP_WEBHOOK_URL'),
  erpWebhookSecret: env('ERP_WEBHOOK_SECRET'),
  // Μετά από πόσα λεπτά κρύβονται οι ολοκληρωμένες παραγγελίες από το recall
  completedRetentionMinutes: Number(env('KDS_COMPLETED_RETENTION_MIN', '120')),
  menuFile: env('KDS_MENU_FILE') || path.join(dataDir, 'menu.json'),
  // PIN του πρώτου διαχειριστή (μόνο αν δεν υπάρχει κανένας χρήστης)
  initialAdminPin: env('KDS_INITIAL_ADMIN_PIN'),
  // Πίσω από reverse proxy / cloud (Railway, Render, nginx): εμπιστεύσου τα X-Forwarded-* headers
  behindProxy: env('KDS_BEHIND_PROXY') === '1',
  stations: loadStations(env('KDS_STATIONS_FILE') || path.join(ROOT, 'config', 'stations.json')),
};

// Προετοιμάζει τον φάκελο δεδομένων στην πρώτη εκκίνηση.
function prepareDataDir(cfg) {
  fs.mkdirSync(path.dirname(cfg.menuFile), { recursive: true });
  if (!fs.existsSync(cfg.menuFile)) {
    // Το αρχικό μενού έρχεται από το config/menu.json (μαζί με όποιες αλλαγές είχαν γίνει εκεί).
    fs.copyFileSync(path.join(ROOT, 'config', 'menu.json'), cfg.menuFile);
    console.log(`[kds] δημιουργήθηκε το μενού ${cfg.menuFile} από το config/menu.json`);
  }
  cfg.secret = env('KDS_SECRET') || loadOrCreateSecret(path.join(cfg.dataDir, 'secret.key'));
}

function loadOrCreateSecret(file) {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret + '\n', { mode: 0o600 });
  return secret;
}

module.exports = { config, loadStations, prepareDataDir };
