// Κοινά βοηθήματα για τα HTTP tests: εκκίνηση server και σύνδεση χρηστών.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../src/db');
const { loadStations } = require('../src/config');
const { createApp } = require('../src/server');

const stations = loadStations(path.join(__dirname, '..', 'config', 'stations.json'));

async function startApp(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kds-test-'));
  const menuFile = path.join(dir, 'menu.json');
  fs.copyFileSync(path.join(__dirname, '..', 'config', 'menu.json'), menuFile);
  const db = openDb(':memory:');
  const cfg = { stations, menuFile, secret: 'test-secret', completedRetentionMinutes: 60, ...extra };
  const { server, auth } = createApp({ db, cfg });
  await new Promise((r) => server.listen(0, r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const client = (cookie = '') => ({
    cookie,
    req: (method, p, body, headers = {}) => fetch(base + p, {
      method,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    }),
    async json(method, p, body) {
      const res = await this.req(method, p, body);
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  });

  let seq = 0;
  async function loginAs(role, pin = String(1000 + (++seq) * 7)) {
    auth.createUser({ name: `${role}-${seq}`, role, pin });
    const res = await client().req('POST', '/api/auth/login', { pin });
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    return client(cookie);
  }

  return { base, db, auth, menuFile, anon: client(), loginAs };
}

module.exports = { startApp, stations };
