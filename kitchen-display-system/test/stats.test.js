const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('στατιστικά: έσοδα, είδη, πόστα, σερβιτόροι', async (t) => {
  const { loginAs, db } = await startApp(t);
  const admin = await loginAs('admin');
  const waiter = await loginAs('waiter');
  const kitchen = await loginAs('kitchen');

  const send = (body) => waiter.json('POST', '/api/pos/orders', body);
  const a = (await send({ order_type: 'dine_in', table: '1', items: [{ menu_id: 'burger-classic', qty: 2 }, { menu_id: 'cola' }] })).body;
  await send({ order_type: 'takeaway', items: [{ menu_id: 'burger-classic' }] });
  const c = (await send({ order_type: 'delivery', items: [{ menu_id: 'moussaka' }] })).body;
  await admin.req('POST', `/api/pos/orders/${c.external_id}/cancel`, {});

  // Η παραγγελία a ετοιμάζεται: ψησταριά σε 6′, μπαρ σε 2′ (πλαστοί χρόνοι).
  await kitchen.req('POST', `/api/orders/${a.id}/bump?station=grill`, {});
  await kitchen.req('POST', `/api/orders/${a.id}/bump?station=bar`, {});
  const rec = db.prepare('SELECT received_at FROM orders WHERE id = ?').get(a.id).received_at;
  const plus = (m) => new Date(new Date(rec).getTime() + m * 60000).toISOString();
  db.prepare("UPDATE order_items SET added_at = ?, done_at = ? WHERE order_id = ? AND station = 'grill'").run(rec, plus(6), a.id);
  db.prepare("UPDATE order_items SET added_at = ?, done_at = ? WHERE order_id = ? AND station = 'bar'").run(rec, plus(2), a.id);
  db.prepare('UPDATE orders SET ready_at = ? WHERE id = ?').run(plus(6), a.id);

  assert.equal((await waiter.req('GET', '/api/stats')).status, 403);
  const { status, body } = await admin.json('GET', `/api/stats?from=${today()}&to=${today()}`);
  assert.equal(status, 200);
  assert.equal(body.totals.orders, 2);
  assert.equal(body.totals.cancelled, 1);
  assert.equal(body.totals.revenue, 33); // 2×10 + 3 + 10
  assert.equal(body.totals.avgOrderValue, 16.5);
  assert.equal(body.totals.avgPrepMinutes, 6);
  assert.deepEqual(body.topItems[0], { name: 'Burger Classic', qty: 3, revenue: 30 });
  assert.equal(body.byStation.find((s) => s.station === 'grill').avgMinutes, 6);
  assert.equal(body.byStation.find((s) => s.station === 'bar').avgMinutes, 2);
  assert.equal(body.byWaiter.length, 1);
  assert.equal(body.byWaiter[0].revenue, 33);
  assert.equal(body.byHour.reduce((s, h) => s + h.orders, 0), 2);
  assert.equal(body.byDay.length, 1);

  assert.equal((await admin.req('GET', '/api/stats?from=xx')).status, 400);
  const empty = (await admin.json('GET', '/api/stats?from=2020-01-01&to=2020-01-07')).body;
  assert.equal(empty.totals.orders, 0);
  assert.equal(empty.byDay.length, 7);
});
