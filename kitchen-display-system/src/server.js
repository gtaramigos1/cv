const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { config, prepareDataDir } = require('./config');
const { openDb } = require('./db');
const { createOrderService, OrderError } = require('./orders');
const { startWebhookDispatcher } = require('./erpWebhook');
const { createPosRouter, createMenuAdminRouter } = require('./pos');
const { MenuError } = require('./menu');
const { createAuth, AuthError } = require('./auth');
const { createStatsRouter } = require('./stats');

const PUBLIC = path.join(__dirname, '..', 'public');
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC, file));

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function createApp({ db, cfg = config }) {
  const app = express();
  if (cfg.behindProxy) app.set('trust proxy', 1); // σωστό IP/HTTPS πίσω από proxy του cloud
  const server = http.createServer(app);
  const auth = createAuth({ db, secret: cfg.secret });
  const { requireRole, requirePage } = auth;

  // Μόνο συνδεδεμένοι χρήστες λαμβάνουν ενημερώσεις σε πραγματικό χρόνο.
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (info, done) => done(Boolean(auth.userFromRequest(info.req)), 401),
  });

  function send(payload) {
    const msg = JSON.stringify(payload);
    for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
  }
  const broadcast = (order) => send({ type: 'order', order });

  const orders = createOrderService(db, cfg.stations, { onChange: broadcast });
  const stationIds = new Set(cfg.stations.stations.map((s) => s.id));

  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(auth.attachUser);

  // ---------- Σελίδες ----------
  app.get('/login', page('login.html'));
  app.get('/', requirePage(), page('index.html'));
  app.get('/pos', requirePage('waiter', 'admin'), page('pos.html'));
  app.get('/admin/menu', requirePage('admin'), page('menu-admin.html'));
  app.get('/admin/users', requirePage('admin'), page('users-admin.html'));
  app.get('/admin/stats', requirePage('admin'), page('stats.html'));
  // Στατικά αρχεία (css/js). Οι σελίδες .html σερβίρονται μόνο μέσω των παραπάνω routes.
  app.use((req, res, next) => (req.path.endsWith('.html') ? res.status(404).end() : next()));
  app.use(express.static(PUBLIC, { index: false }));

  // ---------- ERP API (απαιτεί κλειδί) ----------
  function requireErpKey(req, res, next) {
    if (!cfg.erpApiKey) return next();
    const header = req.get('authorization') || '';
    const key = (header.startsWith('Bearer ') ? header.slice(7) : req.get('x-api-key') || '').trim();
    if (!safeEqual(key, cfg.erpApiKey)) return res.status(401).json({ error: 'Μη έγκυρο API key' });
    next();
  }

  const erp = express.Router();
  erp.use(requireErpKey);

  // Δημιουργία ή ενημέρωση παραγγελίας (idempotent με βάση το external_id)
  erp.post('/orders', (req, res) => {
    const { order, created } = orders.ingestOrder(req.body);
    res.status(created ? 201 : 200).json(order);
  });

  erp.get('/orders/:externalId', (req, res) => {
    const order = orders.getOrderByExternalId(req.params.externalId);
    if (!order) return res.status(404).json({ error: 'Η παραγγελία δεν βρέθηκε' });
    res.json(order);
  });

  erp.post('/orders/:externalId/cancel', (req, res) => {
    res.json(orders.cancelOrder(req.params.externalId));
  });

  app.use('/api/erp', erp);

  // Από εδώ και κάτω: API για τους χρήστες του καταστήματος (σύνδεση με PIN).
  app.use('/api', auth.sameOrigin);
  app.use('/api', auth.router);
  app.use('/api', createStatsRouter({ db, stations: cfg.stations, requireRole }));

  // ---------- Λήψη παραγγελιών από το κατάστημα (/pos) ----------
  const menuFile = cfg.menuFile || path.join(__dirname, '..', 'config', 'menu.json');
  app.use('/api/pos', createPosRouter({ db, orders, menuFile, requireRole }));

  // ---------- Διαχείριση μενού (/admin/menu) ----------
  app.use('/api/admin', createMenuAdminRouter({
    menuFile,
    stations: cfg.stations,
    requireRole,
    onMenuChange: () => send({ type: 'menu' }), // τα POS ξαναφορτώνουν το μενού
  }));

  // ---------- API για τις οθόνες κουζίνας ----------
  function stationParam(req) {
    const s = req.query.station || req.body?.station || null;
    if (s === null || s === 'expo') return null;
    if (!stationIds.has(s)) throw new OrderError(400, `Άγνωστο station "${s}"`);
    return s;
  }
  const idParam = (v) => {
    const id = Number.parseInt(v, 10);
    if (!Number.isFinite(id)) throw new OrderError(400, 'Μη έγκυρο id');
    return id;
  };

  app.use(['/api/config', '/api/orders', '/api/items'], requireRole());

  app.get('/api/config', (req, res) => {
    res.json({ stations: cfg.stations.stations });
  });

  app.get('/api/orders', (req, res) => {
    res.json(orders.listActive(stationParam(req)));
  });

  app.get('/api/orders/recent', (req, res) => {
    res.json(orders.listRecent(stationParam(req), cfg.completedRetentionMinutes));
  });

  app.post('/api/orders/:id/bump', (req, res) => {
    res.json(orders.bump(idParam(req.params.id), stationParam(req)));
  });

  app.post('/api/orders/:id/recall', (req, res) => {
    res.json(orders.recall(idParam(req.params.id), stationParam(req)));
  });

  app.post('/api/items/:id/toggle', (req, res) => {
    res.json(orders.setItemDone(idParam(req.params.id), Boolean(req.body?.done)));
  });

  app.get('/health', (req, res) => res.json({ ok: true }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof OrderError || err instanceof MenuError || err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Μη έγκυρο JSON' });
    console.error(err);
    res.status(500).json({ error: 'Εσωτερικό σφάλμα' });
  });

  // Keep-alive ώστε οι οθόνες να καταλαβαίνουν γρήγορα αν χάθηκε η σύνδεση.
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15_000);
  ping.unref();
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });
  server.on('close', () => clearInterval(ping));

  return { app, server, orders, auth };
}

if (require.main === module) {
  prepareDataDir(config);
  const db = openDb(config.dbFile);
  const { server, auth } = createApp({ db });
  const firstPin = auth.ensureInitialAdmin(config.initialAdminPin);
  if (firstPin) {
    console.log('\n==============================================================');
    console.log('  Δημιουργήθηκε ο πρώτος χρήστης «Διαχειριστής».');
    console.log(`  PIN σύνδεσης: ${firstPin}`);
    console.log('  Άλλαξέ το από τη σελίδα Χρήστες μετά την πρώτη σύνδεση.');
    console.log('==============================================================\n');
  }
  const dispatcher = startWebhookDispatcher(db, { url: config.erpWebhookUrl, secret: config.erpWebhookSecret });
  if (!config.erpApiKey) console.warn('[kds] ΠΡΟΣΟΧΗ: ERP_API_KEY δεν έχει οριστεί — το ERP API είναι ανοιχτό');
  server.listen(config.port, () => {
    console.log(`[kds] σε λειτουργία: http://localhost:${config.port}`);
  });
  const shutdown = () => {
    dispatcher.stop();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
