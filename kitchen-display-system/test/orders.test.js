const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openDb } = require('../src/db');
const { loadStations } = require('../src/config');
const { createOrderService, OrderError } = require('../src/orders');
const { startWebhookDispatcher, sign } = require('../src/erpWebhook');
const { createApp } = require('../src/server');

const stations = loadStations(path.join(__dirname, '..', 'config', 'stations.json'));

function setup() {
  const db = openDb(':memory:');
  const changes = [];
  const svc = createOrderService(db, stations, { onChange: (o) => changes.push(o) });
  return { db, svc, changes };
}

const sample = (extra = {}) => ({
  external_id: 'INV-1',
  table: '5',
  items: [
    { line_id: '1', name: 'Burger', qty: 2, category: 'burgers' },
    { line_id: '2', name: 'Χωριάτικη', category: 'salads' },
    { line_id: '3', name: 'Freddo', category: 'coffee', station: 'bar' },
  ],
  ...extra,
});

const events = (db) => db.prepare('SELECT event, payload FROM outbox ORDER BY id').all()
  .map((r) => ({ event: r.event, status: JSON.parse(r.payload).order.status }));

test('δρομολογεί τα είδη σε stations', () => {
  const { svc } = setup();
  const { order, created } = svc.ingestOrder(sample());
  assert.equal(created, true);
  assert.deepEqual(order.items.map((i) => i.station), ['grill', 'cold', 'bar']);
  assert.equal(svc.routeItem({ category: 'άγνωστο' }), 'kitchen');
  assert.equal(svc.routeItem({ category: 'BURGERS' }), 'grill');
});

test('απορρίπτει μη έγκυρα δεδομένα', () => {
  const { svc } = setup();
  assert.throws(() => svc.ingestOrder({ items: [{ name: 'x' }] }), OrderError);
  assert.throws(() => svc.ingestOrder({ external_id: 'a', items: [] }), /τουλάχιστον ένα/);
  assert.throws(() => svc.ingestOrder({ external_id: 'a', items: [{ name: 'x', qty: 0 }] }), /qty/);
  assert.throws(() => svc.ingestOrder({ external_id: 'a', items: [{ name: 'x', line_id: '1' }, { name: 'y', line_id: '1' }] }), /διπλό/);
});

test('bump ανά station → ready → completed από expo', () => {
  const { db, svc } = setup();
  const { order } = svc.ingestOrder(sample());
  assert.equal(svc.listActive('grill').length, 1);

  let o = svc.bump(order.id, 'grill');
  assert.equal(o.status, 'in_progress');
  assert.equal(svc.listActive('grill').length, 0);
  assert.equal(svc.listActive('cold').length, 1);

  svc.bump(order.id, 'cold');
  o = svc.bump(order.id, 'bar');
  assert.equal(o.status, 'ready');
  assert.ok(o.ready_at);
  assert.equal(svc.listActive(null).length, 1, 'το expo βλέπει ακόμα την έτοιμη παραγγελία');

  o = svc.bump(order.id, null);
  assert.equal(o.status, 'completed');
  assert.equal(svc.listActive(null).length, 0);
  assert.deepEqual(events(db).map((e) => e.status), ['new', 'in_progress', 'ready', 'completed']);
  assert.throws(() => svc.bump(order.id, 'grill'), /ολοκληρωμένη/);
});

test('recall επαναφέρει παραγγελία στο station και ενημερώνει το ERP', () => {
  const { db, svc } = setup();
  const { order } = svc.ingestOrder(sample());
  for (const s of ['grill', 'cold', 'bar']) svc.bump(order.id, s);
  svc.bump(order.id, null);
  assert.equal(svc.listRecent('grill').length, 1);

  const o = svc.recall(order.id, 'grill');
  assert.equal(o.status, 'in_progress');
  assert.equal(svc.listActive('grill').length, 1);
  assert.equal(events(db).at(-1).status, 'in_progress');
});

test('επαναποστολή από ERP: προσθήκη, αλλαγή και αφαίρεση ειδών', () => {
  const { svc } = setup();
  const { order } = svc.ingestOrder(sample());
  svc.bump(order.id, 'grill');
  svc.bump(order.id, 'bar');

  const { order: updated, created } = svc.ingestOrder(sample({
    items: [
      { line_id: '1', name: 'Burger', qty: 3, category: 'burgers' }, // αλλαγή ποσότητας → ξανά σε αναμονή
      { line_id: '3', name: 'Freddo', category: 'coffee', station: 'bar' }, // αμετάβλητο → μένει done
      { line_id: '4', name: 'Μουσακάς', category: 'mains' }, // νέο
    ],
  }));
  assert.equal(created, false);
  const byLine = Object.fromEntries(updated.items.map((i) => [i.line_id, i]));
  assert.equal(byLine['1'].status, 'pending');
  assert.equal(byLine['1'].qty, 3);
  assert.equal(byLine['2'].status, 'voided');
  assert.equal(byLine['3'].status, 'done');
  assert.equal(byLine['4'].station, 'kitchen');
  assert.equal(updated.status, 'in_progress');
});

test('ακύρωση από ERP', () => {
  const { svc, changes } = setup();
  const { order } = svc.ingestOrder(sample());
  const o = svc.cancelOrder('INV-1');
  assert.equal(o.status, 'cancelled');
  assert.equal(svc.listActive(null).length, 0);
  assert.equal(changes.at(-1).status, 'cancelled');
  assert.throws(() => svc.ingestOrder(sample()), /ακυρωμένη/);
  assert.throws(() => svc.setItemDone(order.items[0].id, true), /ακυρωμένη/);
  assert.throws(() => svc.cancelOrder('nope'), /δεν βρέθηκε/);
});

test('toggle είδους', () => {
  const { svc } = setup();
  const { order } = svc.ingestOrder(sample({ items: [{ name: 'Burger', category: 'burgers' }] }));
  assert.equal(svc.setItemDone(order.items[0].id, true).status, 'ready');
  assert.equal(svc.setItemDone(order.items[0].id, false).status, 'new');
});

test('webhook: υπογραφή, παράδοση και επανάληψη σε αποτυχία', async () => {
  const { db, svc } = setup();
  svc.ingestOrder(sample());
  const calls = [];
  let fail = true;
  const fetchImpl = async (url, opts) => {
    calls.push(opts);
    return { ok: !fail, status: fail ? 503 : 200 };
  };
  const log = { info() {}, warn() {} };
  const d = startWebhookDispatcher(db, { url: 'http://erp.test/hook', secret: 's3cret', fetchImpl, log, intervalMs: 60_000 });

  await d.flush();
  let row = db.prepare('SELECT * FROM outbox').get();
  assert.equal(row.attempts, 1);
  assert.equal(row.delivered_at, null);
  assert.equal(row.last_error, 'HTTP 503');

  fail = false;
  db.prepare('UPDATE outbox SET next_attempt_at = ?').run(new Date(0).toISOString());
  await d.flush();
  row = db.prepare('SELECT * FROM outbox').get();
  assert.ok(row.delivered_at);
  assert.equal(calls[1].headers['X-KDS-Signature'], sign('s3cret', calls[1].body));
  assert.equal(calls[1].headers['X-KDS-Event'], 'order.received');
  d.stop();
});

test('HTTP API: έλεγχος κλειδιού και ροή', async (t) => {
  const db = openDb(':memory:');
  const { server } = createApp({ db, cfg: { erpApiKey: 'k', stations, completedRetentionMinutes: 60 } });
  await new Promise((r) => server.listen(0, r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  assert.equal((await post('/api/erp/orders', sample())).status, 401);
  const res = await post('/api/erp/orders', sample(), { Authorization: 'Bearer k' });
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal((await post('/api/erp/orders', sample(), { 'X-API-Key': 'k' })).status, 200);

  const grill = await (await fetch(`${base}/api/orders?station=grill`)).json();
  assert.equal(grill.length, 1);
  assert.equal((await fetch(`${base}/api/orders?station=nope`)).status, 400);

  const bumped = await (await post(`/api/orders/${order.id}/bump?station=grill`, {})).json();
  assert.equal(bumped.status, 'in_progress');
  const bad = await post('/api/erp/orders', { external_id: 'x' }, { Authorization: 'Bearer k' });
  assert.equal(bad.status, 400);
});
