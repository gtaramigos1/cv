const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../src/db');
const { loadStations } = require('../src/config');
const { createApp } = require('../src/server');
const { normalizeMenu } = require('../src/menu');

const stations = loadStations(path.join(__dirname, '..', 'config', 'stations.json'));
const stationIds = new Set(stations.stations.map((s) => s.id));

async function start(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kds-menu-'));
  const menuFile = path.join(dir, 'menu.json');
  fs.copyFileSync(path.join(__dirname, '..', 'config', 'menu.json'), menuFile);
  const { server } = createApp({ db: openDb(':memory:'), cfg: { stations, menuFile, ...extra } });
  await new Promise((r) => server.listen(0, r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = (method, p, body, headers = {}) => fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  return { base, req, menuFile };
}

test('normalizeMenu: καθαρισμός, νέα ids και έλεγχοι', () => {
  const m = normalizeMenu({
    categories: [{ name: ' Πίτσες ', station: 'kitchen', items: [
      { name: 'Μαργαρίτα', price: '9,50', modifiers: [' Extra τυρί ', '', 'Extra τυρί'] },
      { id: 'keep', name: 'Special', available: false },
    ] }],
  }, stationIds);
  const [cat] = m.categories;
  assert.equal(cat.name, 'Πίτσες');
  assert.match(cat.id, /^c_/);
  assert.equal(cat.items[0].price, 9.5);
  assert.deepEqual(cat.items[0].modifiers, ['Extra τυρί']);
  assert.match(cat.items[0].id, /^i_/);
  assert.equal(cat.items[1].id, 'keep');
  assert.equal(cat.items[1].available, false);
  assert.equal(m.currency, '€');

  assert.throws(() => normalizeMenu({ categories: [{ name: '', items: [] }] }, stationIds), /όνομα/);
  assert.throws(() => normalizeMenu({ categories: [{ name: 'x', items: [{ name: 'a', price: -1 }] }] }, stationIds), /τιμή/);
  assert.throws(() => normalizeMenu({ categories: [{ name: 'x', station: 'nope', items: [] }] }, stationIds), /πόστο/);
  assert.throws(() => normalizeMenu({ categories: [{ name: 'x', items: [{ id: 'a', name: 'a' }, { id: 'a', name: 'b' }] }] }, stationIds), /Διπλό/);
});

test('διαχείριση μενού: αποθήκευση, νέα κατηγορία με πόστο, εξαντλημένο είδος', async (t) => {
  const { req, menuFile } = await start(t);
  const data = await (await req('GET', '/api/admin/menu')).json();
  assert.ok(data.stations.length);
  // Οι κατηγορίες του αρχικού μενού δείχνουν το πόστο τους από το categoryRouting.
  assert.equal(data.menu.categories.find((c) => c.id === 'coffee').station, 'bar');

  const menu = data.menu;
  menu.categories.push({ name: 'Πίτσες', station: 'kitchen', items: [{ name: 'Μαργαρίτα', price: 9 }] });
  menu.categories.find((c) => c.id === 'mains').items.find((i) => i.id === 'moussaka').available = false;
  const res = await req('PUT', '/api/admin/menu', menu);
  assert.equal(res.status, 200);
  const savedMenu = (await res.json()).menu;
  const pizza = savedMenu.categories.at(-1).items[0];
  assert.ok(pizza.id);
  assert.ok(fs.existsSync(menuFile.replace(/\.json$/, '.backup.json')));

  // Το νέο είδος πάει στο πόστο της κατηγορίας του.
  let r = await req('POST', '/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: pizza.id }] });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).items[0].station, 'kitchen');

  // Εξαντλημένο είδος δεν περνάει.
  r = await req('POST', '/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: 'moussaka' }] });
  assert.equal(r.status, 409);

  r = await req('PUT', '/api/admin/menu', { categories: [{ name: '', items: [] }] });
  assert.equal(r.status, 400);
  // Το αρχείο δεν άλλαξε μετά από αποτυχημένη αποθήκευση.
  assert.equal(JSON.parse(fs.readFileSync(menuFile, 'utf8')).categories.length, savedMenu.categories.length);
});

test('διαχείριση μενού με PIN', async (t) => {
  const { req } = await start(t, { adminPin: '1234' });
  let r = await req('GET', '/api/admin/menu');
  assert.equal(r.status, 401);
  assert.equal((await r.json()).pinRequired, true);
  r = await req('GET', '/api/admin/menu', null, { 'X-Admin-Pin': '0000' });
  assert.equal(r.status, 401);
  r = await req('GET', '/api/admin/menu', null, { 'X-Admin-Pin': '1234' });
  assert.equal(r.status, 200);
  // Το POS συνεχίζει να διαβάζει το μενού χωρίς PIN.
  assert.equal((await req('GET', '/api/pos/menu')).status, 200);
});
