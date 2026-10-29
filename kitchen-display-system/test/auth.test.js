const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const { openDb } = require('../src/db');
const { createAuth } = require('../src/auth');

test('πρώτος διαχειριστής δημιουργείται μόνο σε άδεια βάση', () => {
  const auth = createAuth({ db: openDb(':memory:'), secret: 's' });
  const pin = auth.ensureInitialAdmin('');
  assert.match(pin, /^\d{6}$/);
  assert.equal(auth.ensureInitialAdmin('1234'), null);
  assert.equal(auth.listUsers()[0].role, 'admin');
});

test('σύνδεση, αποσύνδεση και όριο λάθος PIN', async (t) => {
  const { anon, auth } = await startApp(t);
  auth.createUser({ name: 'Μαρία', role: 'waiter', pin: '4321' });

  let r = await anon.json('POST', '/api/auth/login', { pin: '0000' });
  assert.equal(r.status, 401);
  const ok = await anon.req('POST', '/api/auth/login', { pin: '4321' });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  const me = await (await fetch(ok.url.replace('/login', '/me'), { headers })).json();
  assert.equal(me.user.name, 'Μαρία');
  assert.equal(me.user.role, 'waiter');

  await fetch(ok.url.replace('/login', '/logout'), { method: 'POST', headers });
  assert.equal((await fetch(ok.url.replace('/login', '/me'), { headers })).status, 401);

  // Μετά από 8 λάθος προσπάθειες το IP κλειδώνει, ακόμα και για σωστό PIN.
  for (let i = 0; i < 7; i++) await anon.req('POST', '/api/auth/login', { pin: '9999' });
  r = await anon.json('POST', '/api/auth/login', { pin: '4321' });
  assert.equal(r.status, 200, 'πριν το όριο το σωστό PIN περνάει');
  for (let i = 0; i < 8; i++) await anon.req('POST', '/api/auth/login', { pin: '9999' });
  r = await anon.json('POST', '/api/auth/login', { pin: '4321' });
  assert.equal(r.status, 429);
});

test('διαχείριση χρηστών: μοναδικό PIN, τελευταίος διαχειριστής, αποσύνδεση σε αλλαγή PIN', async (t) => {
  const { loginAs, anon } = await startApp(t);
  const admin = await loginAs('admin', '1111');
  const waiter = await loginAs('waiter', '2222');

  assert.equal((await waiter.req('GET', '/api/admin/users')).status, 403);
  assert.equal((await anon.req('GET', '/admin/users')).status, 302);

  let r = await admin.json('POST', '/api/admin/users', { name: 'Κώστας', role: 'kitchen', pin: '2222' });
  assert.equal(r.status, 409);
  r = await admin.json('POST', '/api/admin/users', { name: 'Κώστας', role: 'kitchen', pin: '12' });
  assert.equal(r.status, 400);
  r = await admin.json('POST', '/api/admin/users', { name: 'Κώστας', role: 'kitchen', pin: '3333' });
  assert.equal(r.status, 201);

  const list = (await admin.json('GET', '/api/admin/users')).body;
  const me = list.users.find((u) => u.id === list.me);
  assert.equal(me.role, 'admin');

  // Ο μοναδικός διαχειριστής δεν μπορεί να απενεργοποιηθεί ή να υποβιβαστεί.
  assert.equal((await admin.req('PATCH', `/api/admin/users/${me.id}`, { active: false })).status, 409);
  assert.equal((await admin.req('PATCH', `/api/admin/users/${me.id}`, { role: 'waiter' })).status, 409);

  // Αλλαγή PIN → ο σερβιτόρος αποσυνδέεται από παντού.
  const w = list.users.find((u) => u.role === 'waiter');
  assert.equal((await waiter.req('GET', '/api/pos/menu')).status, 200);
  r = await admin.json('PATCH', `/api/admin/users/${w.id}`, { pin: '5555' });
  assert.equal(r.status, 200);
  assert.equal((await waiter.req('GET', '/api/pos/menu')).status, 401);

  // Απενεργοποιημένος χρήστης δεν συνδέεται.
  await admin.req('PATCH', `/api/admin/users/${w.id}`, { active: false });
  assert.equal((await anon.req('POST', '/api/auth/login', { pin: '5555' })).status, 401);
});

test('αιτήματα από άλλο site απορρίπτονται', async (t) => {
  const { loginAs } = await startApp(t);
  const admin = await loginAs('admin');
  const r = await admin.req('POST', '/api/admin/users', { name: 'x', role: 'waiter', pin: '7777' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('websocket μόνο για συνδεδεμένους', async (t) => {
  const WebSocket = require('ws');
  const { base, loginAs } = await startApp(t);
  const url = base.replace('http', 'ws') + '/ws';
  const open = (headers) => new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
  assert.equal(await open({}), 401);
  const kitchen = await loginAs('kitchen');
  assert.equal(await open({ Cookie: kitchen.cookie }), 'open');
});
