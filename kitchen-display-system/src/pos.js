// Λήψη παραγγελιών από το κατάστημα (POS σερβιτόρων). Οι παραγγελίες περνούν από την ίδια
// διαδρομή με αυτές του ERP (ingestOrder), οπότε δρομολογούνται και ενημερώνουν το ERP κανονικά.

const fs = require('fs');
const express = require('express');
const { OrderError } = require('./orders');

const POS_PREFIX = 'P-';

// Διαβάζεται σε κάθε αίτημα, ώστε οι αλλαγές στο menu.json να ισχύουν χωρίς επανεκκίνηση.
function loadMenu(file) {
  const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map();
  for (const cat of menu.categories) {
    for (const item of cat.items) {
      if (byId.has(item.id)) throw new Error(`Διπλό id είδους στο μενού: "${item.id}"`);
      byId.set(item.id, { ...item, category: item.category || cat.id, modifiers: item.modifiers || [] });
    }
  }
  return { menu, byId };
}

function createPosRouter({ db, orders, menuFile }) {
  const router = express.Router();
  const lastPosNumber = db.prepare(`
    SELECT MAX(CAST(SUBSTR(external_id, ${POS_PREFIX.length + 1}) AS INTEGER)) AS n
    FROM orders WHERE external_id LIKE '${POS_PREFIX}%'`);

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

module.exports = { createPosRouter, loadMenu };
