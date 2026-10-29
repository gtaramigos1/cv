// Επιχειρησιακή λογική παραγγελιών: εισαγωγή από ERP, δρομολόγηση σε stations,
// bump/recall από τις οθόνες και καταγραφή γεγονότων για το webhook προς το ERP.

const ORDER_TYPES = new Set(['dine_in', 'takeaway', 'delivery']);
const PRIORITIES = new Set(['normal', 'rush']);
const TERMINAL = new Set(['completed', 'cancelled']);

class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();

function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function validateOrderPayload(body) {
  if (!body || typeof body !== 'object') throw new OrderError(400, 'Το σώμα πρέπει να είναι JSON αντικείμενο');
  const externalId = str(body.external_id);
  if (!externalId) throw new OrderError(400, 'Απαιτείται external_id');
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new OrderError(400, 'Απαιτείται τουλάχιστον ένα είδος στο items');
  }
  const orderType = str(body.order_type) || 'dine_in';
  if (!ORDER_TYPES.has(orderType)) throw new OrderError(400, `Άγνωστο order_type "${orderType}"`);
  const priority = str(body.priority) || 'normal';
  if (!PRIORITIES.has(priority)) throw new OrderError(400, `Άγνωστο priority "${priority}"`);

  const seen = new Set();
  const items = body.items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new OrderError(400, `items[${i}]: μη έγκυρο είδος`);
    const name = str(it.name);
    if (!name) throw new OrderError(400, `items[${i}]: απαιτείται name`);
    const qty = it.qty === undefined ? 1 : Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new OrderError(400, `items[${i}]: το qty πρέπει να είναι θετικός αριθμός`);
    const lineId = str(it.line_id) || String(i + 1);
    if (seen.has(lineId)) throw new OrderError(400, `items[${i}]: διπλό line_id "${lineId}"`);
    seen.add(lineId);
    const course = it.course === undefined ? 1 : Number.parseInt(it.course, 10);
    return {
      lineId,
      name,
      qty,
      category: str(it.category),
      station: str(it.station),
      course: Number.isFinite(course) && course > 0 ? course : 1,
      modifiers: Array.isArray(it.modifiers) ? it.modifiers.map(String) : [],
      notes: str(it.notes),
    };
  });

  return {
    externalId,
    orderType,
    priority,
    table: str(body.table),
    customerName: str(body.customer_name),
    waiter: str(body.waiter),
    notes: str(body.notes),
    erpCreatedAt: str(body.created_at),
    items,
  };
}

function createOrderService(db, stationsConfig, { onChange = () => {} } = {}) {
  const stationIds = new Set(stationsConfig.stations.map((s) => s.id));
  const routing = stationsConfig.categoryRouting || {};

  function routeItem(item) {
    if (item.station && stationIds.has(item.station)) return item.station;
    const cat = item.category && item.category.toLowerCase();
    if (cat && routing[cat]) return routing[cat];
    return stationsConfig.defaultStation;
  }

  const q = {
    orderByExternal: db.prepare('SELECT * FROM orders WHERE external_id = ?'),
    orderById: db.prepare('SELECT * FROM orders WHERE id = ?'),
    itemsByOrder: db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY course, id'),
    itemById: db.prepare('SELECT * FROM order_items WHERE id = ?'),
    insertOrder: db.prepare(`
      INSERT INTO orders (external_id, order_type, table_label, customer_name, waiter, notes, priority,
                          status, erp_created_at, received_at, updated_at)
      VALUES (@externalId, @orderType, @table, @customerName, @waiter, @notes, @priority,
              'new', @erpCreatedAt, @ts, @ts)`),
    updateOrderHeader: db.prepare(`
      UPDATE orders SET order_type=@orderType, table_label=@table, customer_name=@customerName,
             waiter=@waiter, notes=@notes, priority=@priority, updated_at=@ts WHERE id=@id`),
    insertItem: db.prepare(`
      INSERT INTO order_items (order_id, line_id, name, qty, category, station, course, modifiers, notes, status, added_at)
      VALUES (@orderId, @lineId, @name, @qty, @category, @station, @course, @modifiers, @notes, 'pending', @ts)`),
    updateItem: db.prepare(`
      UPDATE order_items SET name=@name, qty=@qty, category=@category, station=@station, course=@course,
             modifiers=@modifiers, notes=@notes, status=@status, done_at=@doneAt WHERE id=@id`),
    setItemStatus: db.prepare('UPDATE order_items SET status=?, done_at=? WHERE id=?'),
    setOrderStatus: db.prepare(`
      UPDATE orders SET status=@status, ready_at=@readyAt, completed_at=@completedAt,
             cancelled_at=@cancelledAt, updated_at=@ts WHERE id=@id`),
    activeOrders: db.prepare(`SELECT * FROM orders WHERE status NOT IN ('completed','cancelled')
                              ORDER BY CASE priority WHEN 'rush' THEN 0 ELSE 1 END, received_at`),
    recentForStation: db.prepare(`
      SELECT DISTINCT o.* FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE i.station = @station AND o.status != 'cancelled' AND o.updated_at >= @since
        AND NOT EXISTS (SELECT 1 FROM order_items p WHERE p.order_id = o.id AND p.station = @station AND p.status = 'pending')
      ORDER BY o.updated_at DESC LIMIT 10`),
    recentCompleted: db.prepare(`SELECT * FROM orders WHERE status = 'completed' AND completed_at >= ?
                                 ORDER BY completed_at DESC LIMIT 10`),
    enqueue: db.prepare(`INSERT INTO outbox (event, payload, next_attempt_at) VALUES (?, ?, ?)`),
  };

  function hydrate(order) {
    if (!order) return null;
    const items = q.itemsByOrder.all(order.id).map((it) => ({
      id: it.id,
      line_id: it.line_id,
      name: it.name,
      qty: it.qty,
      category: it.category,
      station: it.station,
      course: it.course,
      modifiers: JSON.parse(it.modifiers),
      notes: it.notes,
      status: it.status,
      added_at: it.added_at,
      done_at: it.done_at,
    }));
    return {
      id: order.id,
      external_id: order.external_id,
      order_type: order.order_type,
      table: order.table_label,
      customer_name: order.customer_name,
      waiter: order.waiter,
      notes: order.notes,
      priority: order.priority,
      status: order.status,
      erp_created_at: order.erp_created_at,
      received_at: order.received_at,
      ready_at: order.ready_at,
      completed_at: order.completed_at,
      cancelled_at: order.cancelled_at,
      updated_at: order.updated_at,
      items,
    };
  }

  function enqueueEvent(event, order) {
    const payload = {
      event,
      occurred_at: now(),
      order: {
        external_id: order.external_id,
        status: order.status,
        ready_at: order.ready_at,
        completed_at: order.completed_at,
        cancelled_at: order.cancelled_at,
        items: order.items.map((i) => ({
          line_id: i.line_id, name: i.name, qty: i.qty, station: i.station, status: i.status, done_at: i.done_at,
        })),
      },
    };
    q.enqueue.run(event, JSON.stringify(payload), now());
  }

  // Υπολογίζει την κατάσταση της παραγγελίας από τα είδη της και καταγράφει αλλαγές.
  function recompute(orderId, { forceStatus, prevStatus } = {}) {
    const order = q.orderById.get(orderId);
    const prev = prevStatus || order.status;
    const ts = now();
    let status = forceStatus;
    if (!status) {
      if (TERMINAL.has(order.status)) status = order.status;
      else {
        const active = q.itemsByOrder.all(orderId).filter((i) => i.status !== 'voided');
        const done = active.filter((i) => i.status === 'done').length;
        if (active.length === 0) status = 'cancelled';
        else if (done === active.length) status = 'ready';
        else if (done > 0) status = 'in_progress';
        else status = 'new';
      }
    }
    q.setOrderStatus.run({
      id: orderId,
      status,
      readyAt: status === 'ready' || status === 'completed' ? order.ready_at || ts : null,
      completedAt: status === 'completed' ? order.completed_at || ts : null,
      cancelledAt: status === 'cancelled' ? order.cancelled_at || ts : null,
      ts,
    });
    const full = hydrate(q.orderById.get(orderId));
    if (status !== prev) enqueueEvent('order.status_changed', full);
    return full;
  }

  function loadOrder(orderId) {
    const order = q.orderById.get(orderId);
    if (!order) throw new OrderError(404, 'Η παραγγελία δεν βρέθηκε');
    return order;
  }

  function assertOpen(order) {
    if (TERMINAL.has(order.status)) {
      throw new OrderError(409, `Η παραγγελία είναι ήδη ${order.status === 'completed' ? 'ολοκληρωμένη' : 'ακυρωμένη'}`);
    }
  }

  const ingestTx = db.transaction((data) => {
    const ts = now();
    const existing = q.orderByExternal.get(data.externalId);

    if (!existing) {
      const { lastInsertRowid } = q.insertOrder.run({ ...data, ts });
      for (const it of data.items) {
        q.insertItem.run({
          orderId: lastInsertRowid, ...it, station: routeItem(it), modifiers: JSON.stringify(it.modifiers), ts,
        });
      }
      const order = hydrate(q.orderById.get(lastInsertRowid));
      enqueueEvent('order.received', order);
      return { order, created: true };
    }

    // Επαναποστολή της ίδιας παραγγελίας = ενημέρωση (προσθήκες, αλλαγές ποσότητας, αφαιρέσεις).
    assertOpen(existing);
    q.updateOrderHeader.run({ ...data, id: existing.id, ts });
    const current = new Map(q.itemsByOrder.all(existing.id).map((i) => [i.line_id, i]));
    for (const it of data.items) {
      const station = routeItem(it);
      const old = current.get(it.lineId);
      if (!old) {
        q.insertItem.run({ orderId: existing.id, ...it, station, modifiers: JSON.stringify(it.modifiers), ts });
        continue;
      }
      current.delete(it.lineId);
      const changed = old.qty !== it.qty || old.name !== it.name || old.notes !== it.notes
        || old.modifiers !== JSON.stringify(it.modifiers) || old.station !== station;
      // Αν άλλαξε κάτι σε είδος που είχε ήδη γίνει (ή είχε αφαιρεθεί), ξαναμπαίνει στην αναμονή.
      const status = changed || old.status === 'voided' ? 'pending' : old.status;
      q.updateItem.run({
        id: old.id, ...it, station, modifiers: JSON.stringify(it.modifiers),
        status, doneAt: status === 'done' ? old.done_at : null,
      });
    }
    for (const removed of current.values()) {
      if (removed.status !== 'voided') q.setItemStatus.run('voided', null, removed.id);
    }
    return { order: recompute(existing.id), created: false };
  });

  function ingestOrder(body) {
    const data = validateOrderPayload(body);
    const result = ingestTx(data);
    onChange(result.order);
    return result;
  }

  function mutate(fn) {
    const tx = db.transaction(fn);
    return (...args) => {
      const order = tx(...args);
      onChange(order);
      return order;
    };
  }

  const cancelOrder = mutate((externalId) => {
    const order = q.orderByExternal.get(String(externalId));
    if (!order) throw new OrderError(404, 'Η παραγγελία δεν βρέθηκε');
    if (order.status === 'cancelled') return hydrate(order);
    assertOpen(order);
    return recompute(order.id, { forceStatus: 'cancelled' });
  });

  const setItemDone = mutate((itemId, done) => {
    const item = q.itemById.get(itemId);
    if (!item) throw new OrderError(404, 'Το είδος δεν βρέθηκε');
    assertOpen(loadOrder(item.order_id));
    if (item.status === 'voided') throw new OrderError(409, 'Το είδος έχει αφαιρεθεί');
    q.setItemStatus.run(done ? 'done' : 'pending', done ? now() : null, itemId);
    return recompute(item.order_id);
  });

  // Bump από station: ολοκληρώνει όλα τα είδη του station. Από expo (station = null): ολοκληρώνει την παραγγελία.
  const bump = mutate((orderId, station) => {
    const order = loadOrder(orderId);
    assertOpen(order);
    const ts = now();
    for (const it of q.itemsByOrder.all(orderId)) {
      if (it.status === 'pending' && (!station || it.station === station)) q.setItemStatus.run('done', ts, it.id);
    }
    return station ? recompute(orderId) : recompute(orderId, { forceStatus: 'completed' });
  });

  // Recall: φέρνει πίσω στην οθόνη την τελευταία παραγγελία που έγινε bump κατά λάθος.
  const recall = mutate((orderId, station) => {
    const order = loadOrder(orderId);
    if (order.status === 'cancelled') throw new OrderError(409, 'Η παραγγελία είναι ακυρωμένη');
    if (!station) {
      if (order.status !== 'completed') return hydrate(order);
      q.setOrderStatus.run({ id: orderId, status: 'ready', readyAt: order.ready_at, completedAt: null, cancelledAt: null, ts: now() });
      return recompute(orderId, { prevStatus: 'completed' });
    }
    for (const it of q.itemsByOrder.all(orderId)) {
      if (it.status === 'done' && it.station === station) q.setItemStatus.run('pending', null, it.id);
    }
    if (order.status === 'completed') {
      q.setOrderStatus.run({ id: orderId, status: 'in_progress', readyAt: null, completedAt: null, cancelledAt: null, ts: now() });
    }
    return recompute(orderId, { prevStatus: order.status });
  });

  function listActive(station) {
    const orders = q.activeOrders.all().map(hydrate);
    if (!station) return orders;
    return orders.filter((o) => o.items.some((i) => i.station === station && i.status === 'pending'));
  }

  function listRecent(station, retentionMinutes = 120) {
    const since = new Date(Date.now() - retentionMinutes * 60000).toISOString();
    const rows = station ? q.recentForStation.all({ station, since }) : q.recentCompleted.all(since);
    return rows.map(hydrate);
  }

  function getOrderByExternalId(externalId) {
    return hydrate(q.orderByExternal.get(String(externalId)));
  }

  return {
    ingestOrder, cancelOrder, setItemDone, bump, recall, listActive, listRecent, getOrderByExternalId, routeItem,
  };
}

module.exports = { createOrderService, validateOrderPayload, OrderError };
