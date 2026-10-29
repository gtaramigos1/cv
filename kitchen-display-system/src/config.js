const fs = require('fs');
const path = require('path');

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

const config = {
  port: Number(process.env.PORT || 3000),
  dbFile: process.env.KDS_DB || path.join(__dirname, '..', 'data', 'kds.sqlite'),
  // Κλειδί που πρέπει να στέλνει το ERP (Authorization: Bearer <key> ή X-API-Key)
  erpApiKey: process.env.ERP_API_KEY || '',
  // Πού στέλνει το KDS ενημερώσεις κατάστασης πίσω στο ERP (κενό = απενεργοποιημένο)
  erpWebhookUrl: process.env.ERP_WEBHOOK_URL || '',
  erpWebhookSecret: process.env.ERP_WEBHOOK_SECRET || '',
  // Μετά από πόσα λεπτά κρύβονται οι ολοκληρωμένες παραγγελίες από το recall
  completedRetentionMinutes: Number(process.env.KDS_COMPLETED_RETENTION_MIN || 120),
  stations: loadStations(process.env.KDS_STATIONS_FILE || path.join(__dirname, '..', 'config', 'stations.json')),
};

module.exports = { config, loadStations };
