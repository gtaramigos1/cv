// Ανάγνωση, έλεγχος και αποθήκευση του μενού (config/menu.json).

const fs = require('fs');
const crypto = require('crypto');

class MenuError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const newId = (prefix) => `${prefix}${crypto.randomBytes(4).toString('hex')}`;

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// Καθαρίζει και ελέγχει ένα μενού όπως έρχεται από τη σελίδα διαχείρισης.
// Όσα είδη/κατηγορίες δεν έχουν id παίρνουν καινούριο.
function normalizeMenu(input, stationIds) {
  if (!input || !Array.isArray(input.categories)) throw new MenuError('Το μενού πρέπει να έχει categories');
  const catIds = new Set();
  const itemIds = new Set();

  const categories = input.categories.map((c, ci) => {
    const name = str(c && c.name);
    if (!name) throw new MenuError(`Η κατηγορία #${ci + 1} δεν έχει όνομα`);
    const id = str(c.id) || newId('c_');
    if (catIds.has(id)) throw new MenuError(`Διπλό id κατηγορίας "${id}"`);
    catIds.add(id);
    const station = str(c.station);
    if (station && !stationIds.has(station)) throw new MenuError(`Άγνωστο πόστο "${station}" στην κατηγορία "${name}"`);
    if (!Array.isArray(c.items)) throw new MenuError(`Η κατηγορία "${name}" δεν έχει λίστα ειδών`);

    const items = c.items.map((it, ii) => {
      const itemName = str(it && it.name);
      if (!itemName) throw new MenuError(`Είδος #${ii + 1} στην κατηγορία "${name}" δεν έχει όνομα`);
      const itemId = str(it.id) || newId('i_');
      if (itemIds.has(itemId)) throw new MenuError(`Διπλό id είδους "${itemId}"`);
      itemIds.add(itemId);

      let price = null;
      if (it.price !== undefined && it.price !== null && str(it.price) !== '') {
        price = Number(String(it.price).replace(',', '.'));
        if (!Number.isFinite(price) || price < 0) throw new MenuError(`Μη έγκυρη τιμή στο "${itemName}"`);
        price = Math.round(price * 100) / 100;
      }
      const itemStation = str(it.station);
      if (itemStation && !stationIds.has(itemStation)) throw new MenuError(`Άγνωστο πόστο "${itemStation}" στο "${itemName}"`);
      const modifiers = [...new Set((Array.isArray(it.modifiers) ? it.modifiers : []).map(str).filter(Boolean))];

      const out = { id: itemId, name: itemName };
      if (price !== null) out.price = price;
      if (modifiers.length) out.modifiers = modifiers;
      if (itemStation) out.station = itemStation;
      if (it.available === false) out.available = false;
      return out;
    });

    const out = { id, name };
    if (station) out.station = station;
    out.items = items;
    return out;
  });

  return { currency: str(input.currency) || '€', categories };
}

function readMenu(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Μενού + ευρετήριο ειδών με το πόστο/κατηγορία που ισχύει για καθένα.
function loadMenu(file) {
  const menu = readMenu(file);
  const byId = new Map();
  for (const cat of menu.categories) {
    for (const item of cat.items) {
      if (byId.has(item.id)) throw new Error(`Διπλό id είδους στο μενού: "${item.id}"`);
      byId.set(item.id, {
        ...item,
        category: item.category || cat.id,
        station: item.station || cat.station,
        modifiers: item.modifiers || [],
        available: item.available !== false,
      });
    }
  }
  return { menu, byId };
}

// Ασφαλής εγγραφή: κρατά αντίγραφο του προηγούμενου και γράφει πρώτα σε προσωρινό αρχείο.
function saveMenu(file, menu) {
  if (fs.existsSync(file)) fs.copyFileSync(file, file.replace(/\.json$/, '') + '.backup.json');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(menu, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { normalizeMenu, loadMenu, readMenu, saveMenu, MenuError };
