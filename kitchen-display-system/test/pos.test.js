const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

test('POS: μενού, αποστολή παραγγελίας, τιμές και ακύρωση', async (t) => {
  const { anon, loginAs } = await startApp(t, { erpApiKey: 'k' });
  const waiter = await loginAs('waiter');
  const kitchen = await loginAs('kitchen');
  const admin = await loginAs('admin');

  assert.equal((await anon.req('GET', '/api/pos/menu')).status, 401);
  const menu = await waiter.json('GET', '/api/pos/menu');
  assert.ok(menu.body.categories.length > 0);

  // Σελίδες: χωρίς σύνδεση → ανακατεύθυνση στο login· η κουζίνα δεν έχει POS.
  const page = await anon.req('GET', '/pos');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login\?next=/);
  assert.equal((await waiter.req('GET', '/pos')).status, 200);
  assert.equal((await kitchen.req('GET', '/pos')).status, 302);
  assert.equal((await anon.req('GET', '/pos.html')).status, 404);

  let res = await waiter.req('POST', '/api/pos/orders', { order_type: 'dine_in', items: [{ menu_id: 'moussaka' }] });
  assert.equal(res.status, 400);
  res = await waiter.req('POST', '/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: 'nope' }] });
  assert.equal(res.status, 400);
  res = await kitchen.req('POST', '/api/pos/orders', { order_type: 'takeaway', items: [{ menu_id: 'water' }] });
  assert.equal(res.status, 403);

  res = await waiter.req('POST', '/api/pos/orders', {
    order_type: 'dine_in', table: '4', waiter: 'Ψεύτικο όνομα',
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
  assert.match(order.waiter, /^waiter-/, 'ο σερβιτόρος έρχεται από τον λογαριασμό');
  assert.deepEqual(order.items.map((i) => [i.name, i.station, i.qty, i.course, i.price]), [
    ['Burger Classic', 'grill', 2, 1, 10], ['Freddo Espresso', 'bar', 1, 1, 3.5], ['Σοκολατόπιτα', 'cold', 1, 2, 5.5],
  ]);

  const second = (await waiter.json('POST', '/api/pos/orders', { order_type: 'takeaway', customer_name: 'Νίκος', items: [{ menu_id: 'water' }] })).body;
  assert.equal(second.external_id, 'P-2');
  assert.equal(second.table, null);

  // Ακύρωση μόνο από διαχειριστή.
  assert.equal((await waiter.req('POST', '/api/pos/orders/P-1/cancel', {})).status, 403);
  const cancelled = await admin.json('POST', '/api/pos/orders/P-1/cancel', {});
  assert.equal(cancelled.body.status, 'cancelled');
});
