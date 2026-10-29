const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { normalizeMenu } = require('../src/menu');
const { startApp, stations } = require('./helpers');
const stationIds = new Set(stations.stations.map((s) => s.id));

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
  const { menuFile, loginAs } = await startApp(t);
  const admin = await loginAs('admin');
  const waiter = await loginAs('waiter');
  assert.equal((await waiter.req('GET', '/api/admin/menu')).status, 403);

  const data = (await admin.json('GET', '/api/admin/menu')).body;
  assert.ok(data.stations.length);
  // Οι κατηγορίες του αρχικού μενού δείχνουν το πόστο τους από το categoryRouting.
  assert.equal(data.menu.categories.find((c) => c.id === 'coffee').station, 'bar');

  const menu = data.menu;
  menu.categories.push({ name: 'Πίτσες', station: 'kitchen', items: [{ name: 'Μαργαρίτα', price: 9 }] });
  menu.categories.find((c) => c.id === 'mains').items.find((i) => i.id === 'moussaka').available = false;
  assert.equal((await waiter.req('PUT', '/api/admin/menu', menu)).status, 403);
  const res = await admin.json('PUT', '/api/admin/menu', menu);
  assert.equal(res.status, 200);
  const savedMenu = res.body.menu;
  const pizza = savedMenu.categories.at(-1).items[0];
  assert.ok(pizza.id);
  assert.ok(fs.existsSync(menuFile.replace(/\.json$/, '.backup.json')));

  // Το νέο είδος πάει στο πόστο της κατηγορίας του.
  let r = await waiter.json('POST', '/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: pizza.id }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.items[0].station, 'kitchen');

  // Εξαντλημένο είδος δεν περνάει.
  r = await waiter.req('POST', '/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: 'moussaka' }] });
  assert.equal(r.status, 409);

  r = await admin.req('PUT', '/api/admin/menu', { categories: [{ name: '', items: [] }] });
  assert.equal(r.status, 400);
  // Το αρχείο δεν άλλαξε μετά από αποτυχημένη αποθήκευση.
  assert.equal(JSON.parse(fs.readFileSync(menuFile, 'utf8')).categories.length, savedMenu.categories.length);
});
