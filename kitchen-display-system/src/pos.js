// Λήψη παραγγελιών από το κατάστημα (POS σερβιτόρων) και διαχείριση μενού.
// Οι παραγγελίες περνούν από την ίδια διαδρομή με αυτές του ERP (ingestOrder),
// οπότε δρομολογούνται και ενημερώνουν το ERP κανονικά.

const crypto = require('crypto');
const express = require('express');
const { OrderError } = require('./orders');
const { loadMenu, readMenu, normalizeMenu, saveMenu } = require('./menu');

const POS_PREFIX = 'P-';

function createPosRouter({ db, orders, menuFile }) {
  const router = express.Router();
  const lastPosNumber = db.prepare(`
    SELECT MAX(CAST(SUBSTR(external_id, ${POS_PREFIX.length + 1}) AS INTEGER)) AS n
    FROM orders WHERE external_id LIKE '${POS_PREFIX}%'`);

  // Διαβάζεται σε κάθε αίτημα, ώστε οι αλλαγές στο μενού να ισχύουν χωρίς επανεκκίνηση.
  router.get('/menu', (req, res) => {
    res.json(loadMenu(menuFile).menu);
  });

  router.post('/orders', (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new OrderError(400, 'Η παραγγελία δεν έχει είδη');
    }
    const orderType = body.order_type || 'dine_in';
    if (orderType === 'dine_in' && !String(body.table ?? '').trim()) {
      throw new OrderError(400, 'Συμπλήρωσε αριθμό τραπεζιού');
    }

    // Όνομα και κατηγορία έρχονται από το μενού του server, όχι από τον browser.
    const { byId } = loadMenu(menuFile);
    const items = body.items.map((line, i) => {
      const item = byId.get(line.menu_id);
      if (!item) throw new OrderError(400, `Άγνωστο είδος "${line.menu_id}"`);
      if (!item.available) throw new OrderError(409, `Το "${item.name}" έχει εξαντληθεί`);
      return {
        line_id: String(i + 1),
        name: item.name,
        qty: line.qty,
        category: item.category,
        station: item.station,
        course: line.course,
        modifiers: Array.isArray(line.modifiers) ? line.modifiers : [],
        notes: line.notes,
      };
    });

    const next = (lastPosNumber.get().n || 0) + 1;
    const { order } = orders.ingestOrder({
      external_id: `${POS_PREFIX}${next}`,
      order_type: orderType,
      table: orderType === 'dine_in' ? body.table : null,
      customer_name: body.customer_name,
      waiter: body.waiter,
      notes: body.notes,
      priority: body.priority,
      created_at: new Date().toISOString(),
      items,
    });
    res.status(201).json(order);
  });

  router.post('/orders/:externalId/cancel', (req, res) => {
    res.json(orders.cancelOrder(req.params.externalId));
  });

  return router;
}

function createMenuAdminRouter({ menuFile, stations, adminPin, onMenuChange = () => {} }) {
  const router = express.Router();
  const stationIds = new Set(stations.stations.map((s) => s.id));
  const routing = stations.categoryRouting || {};

  // Αν έχει οριστεί KDS_ADMIN_PIN, η διαχείριση ζητά το PIN (header X-Admin-Pin).
  router.use((req, res, next) => {
    if (!adminPin) return next();
    const pin = Buffer.from(String(req.get('x-admin-pin') || ''));
    const want = Buffer.from(adminPin);
    if (pin.length === want.length && crypto.timingSafeEqual(pin, want)) return next();
    res.status(401).json({ error: 'Λάθος PIN διαχείρισης', pinRequired: true });
  });

  router.get('/menu', (req, res) => {
    const menu = readMenu(menuFile);
    // Οι παλιές κατηγορίες δρομολογούνται μέσω categoryRouting· δείχνουμε το πόστο τους ρητά.
    for (const c of menu.categories) {
      if (!c.station && routing[c.id]) c.station = routing[c.id];
    }
    res.json({
      menu,
      stations: stations.stations.map((s) => ({ id: s.id, name: s.name })),
      defaultStation: stations.defaultStation,
    });
  });

  router.put('/menu', (req, res) => {
    const menu = normalizeMenu(req.body, stationIds);
    saveMenu(menuFile, menu);
    onMenuChange();
    res.json({ menu });
  });

  return router;
}

module.exports = { createPosRouter, createMenuAdminRouter };
