const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { config } = require('./config');
const { openDb } = require('./db');
const { createOrderService, OrderError } = require('./orders');
const { startWebhookDispatcher } = require('./erpWebhook');
const { createPosRouter } = require('./pos');

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function createApp({ db, cfg = config }) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(order) {
    const msg = JSON.stringify({ type: 'order', order });
    for (const client of wss.clients) if (client.readyState === 1) client.send(msg);
  }

  const orders = createOrderService(db, cfg.stations, { onChange: broadcast });
  const stationIds = new Set(cfg.stations.stations.map((s) => s.id));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

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

  // ---------- Λήψη παραγγελιών από το κατάστημα (/pos) ----------
  app.use('/api/pos', createPosRouter({
    db, orders, menuFile: cfg.menuFile || path.join(__dirname, '..', 'config', 'menu.json'),
  }));
  app.get('/pos', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'pos.html')));

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
    if (err instanceof OrderError) return res.status(err.status).json({ error: err.message });
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

  return { app, server, orders };
}

if (require.main === module) {
  const db = openDb(config.dbFile);
  const { server } = createApp({ db });
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
