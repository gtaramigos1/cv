const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openDb } = require('../src/db');
const { loadStations } = require('../src/config');
const { createApp } = require('../src/server');

const stations = loadStations(path.join(__dirname, '..', 'config', 'stations.json'));
const menuFile = path.join(__dirname, '..', 'config', 'menu.json');

test('POS: μενού, αποστολή παραγγελίας και ακύρωση', async (t) => {
  const db = openDb(':memory:');
  const { server } = createApp({ db, cfg: { erpApiKey: 'k', stations, menuFile, completedRetentionMinutes: 60 } });
  await new Promise((r) => server.listen(0, r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  const menu = await (await fetch(`${base}/api/pos/menu`)).json();
  assert.ok(menu.categories.length > 0);
  assert.equal((await fetch(`${base}/pos`)).status, 200);

  // Χωρίς τραπέζι → 400
  let res = await post('/api/pos/orders', { order_type: 'dine_in', items: [{ menu_id: 'moussaka' }] });
  assert.equal(res.status, 400);
  // Άγνωστο είδος → 400
  res = await post('/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: 'nope' }] });
  assert.equal(res.status, 400);

  // Δεν απαιτεί ERP API key· όνομα/κατηγορία παίρνονται από το μενού.
  res = await post('/api/pos/orders', {
    order_type: 'dine_in', table: '4', waiter: 'Άννα',
    items: [
      { menu_id: 'burger-classic', qty: 2, modifiers: ['Χωρίς κρεμμύδι'], notes: 'καλοψημένο' },
      { menu_id: 'freddo-espresso', qty: 1, modifiers: ['Μέτριος'] },
      { menu_id: 'chocopie', qty: 1, course: 2 },
    ],
  });
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.external_id, 'P-1');
  assert.equal(order.table, '4');
  assert.deepEqual(order.items.map((i) => [i.name, i.station, i.qty, i.course]), [
    ['Burger Classic', 'grill', 2, 1], ['Freddo Espresso', 'bar', 1, 1], ['Σοκολατόπιτα', 'cold', 1, 2],
  ]);
  assert.deepEqual(order.items[0].modifiers, ['Χωρίς κρεμμύδι']);

  const second = await (await post('/api/pos/orders', { order_type: 'takeaway', customer_name: 'Νίκος', items: [{ menu_id: 'water' }] })).json();
  assert.equal(second.external_id, 'P-2');
  assert.equal(second.table, null);

  const grill = await (await fetch(`${base}/api/orders?station=grill`)).json();
  assert.equal(grill.length, 1);

  const cancelled = await (await post('/api/pos/orders/P-1/cancel', {})).json();
  assert.equal(cancelled.status, 'cancelled');
});
