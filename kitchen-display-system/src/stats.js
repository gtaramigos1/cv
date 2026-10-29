// Στατιστικά πωλήσεων και χρόνων κουζίνας για ένα διάστημα.
// Η ομαδοποίηση ανά ημέρα/ώρα γίνεται στην τοπική ώρα του server (μεταβλητή TZ).

const express = require('express');

// Χρόνοι πάνω από αυτό το όριο θεωρούνται ξεχασμένα tickets και δεν μετράνε στους μέσους όρους.
const MAX_PREP_MINUTES = 180;

const minutesBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseDay(s, name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) {
    const err = new Error(`Μη έγκυρη ημερομηνία ${name} (μορφή ΕΕΕΕ-ΜΜ-ΗΗ)`);
    err.status = 400;
    throw err;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

function computeStats(db, stationsConfig, { from, to }) {
  const start = parseDay(from, 'from');
  const end = parseDay(to, 'to');
  if (end < start) {
    const err = new Error('Η ημερομηνία «έως» είναι πριν από την «από»');
    err.status = 400;
    throw err;
  }
  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);

  const orders = db.prepare(`SELECT * FROM orders WHERE received_at >= ? AND received_at < ? ORDER BY received_at`)
    .all(start.toISOString(), endExclusive.toISOString());
  const items = db.prepare(`
    SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.received_at >= ? AND o.received_at < ?`).all(start.toISOString(), endExclusive.toISOString());

  const itemsByOrder = new Map();
  for (const it of items) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
    itemsByOrder.get(it.order_id).push(it);
  }

  // Κενές ημέρες του διαστήματος, για συνεχή γραφήματα.
  const byDay = new Map();
  for (let d = new Date(start); d < endExclusive; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    byDay.set(localDate(d), { date: localDate(d), orders: 0, revenue: 0 });
  }
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }));
  const byItem = new Map();
  const byWaiter = new Map();
  const byType = new Map();
  const stationTimes = new Map();
  const orderPrep = [];
  let cancelled = 0;
  let revenue = 0;
  let itemCount = 0;
  let unpricedItems = 0;
  let validOrders = 0;

  for (const o of orders) {
    if (o.status === 'cancelled') { cancelled += 1; continue; }
    validOrders += 1;
    const lines = (itemsByOrder.get(o.id) || []).filter((i) => i.status !== 'voided');
    let orderRevenue = 0;
    for (const it of lines) {
      const lineRevenue = typeof it.unit_price === 'number' ? it.unit_price * it.qty : 0;
      if (typeof it.unit_price !== 'number') unpricedItems += 1;
      orderRevenue += lineRevenue;
      itemCount += it.qty;
      const row = byItem.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
      row.qty += it.qty;
      row.revenue += lineRevenue;
      byItem.set(it.name, row);

      if (it.status === 'done' && it.done_at) {
        const m = minutesBetween(it.added_at, it.done_at);
        if (m >= 0 && m <= MAX_PREP_MINUTES) {
          if (!stationTimes.has(it.station)) stationTimes.set(it.station, { items: 0, times: [] });
          const st = stationTimes.get(it.station);
          st.items += it.qty;
          st.times.push(m);
        }
      }
    }
    revenue += orderRevenue;

    const at = new Date(o.received_at);
    const day = byDay.get(localDate(at));
    if (day) { day.orders += 1; day.revenue += orderRevenue; }
    byHour[at.getHours()].orders += 1;
    byHour[at.getHours()].revenue += orderRevenue;

    const waiter = o.waiter || (o.external_id.startsWith('P-') ? '—' : 'ERP');
    const w = byWaiter.get(waiter) || { waiter, orders: 0, revenue: 0 };
    w.orders += 1;
    w.revenue += orderRevenue;
    byWaiter.set(waiter, w);

    const t = byType.get(o.order_type) || { type: o.order_type, orders: 0, revenue: 0 };
    t.orders += 1;
    t.revenue += orderRevenue;
    byType.set(o.order_type, t);

    if (o.ready_at) {
      const m = minutesBetween(o.received_at, o.ready_at);
      if (m >= 0 && m <= MAX_PREP_MINUTES) orderPrep.push(m);
    }
  }

  const money = (rows) => rows.map((r) => ({ ...r, revenue: round(r.revenue) }));
  const stationNames = new Map(stationsConfig.stations.map((s) => [s.id, s]));

  return {
    range: { from: localDate(start), to: localDate(end) },
    totals: {
      orders: validOrders,
      cancelled,
      items: round(itemCount, 2),
      revenue: round(revenue),
      avgOrderValue: validOrders ? round(revenue / validOrders) : 0,
      avgPrepMinutes: orderPrep.length ? round(avg(orderPrep), 1) : null,
      medianPrepMinutes: orderPrep.length ? round(median(orderPrep), 1) : null,
      unpricedItems,
    },
    byDay: money([...byDay.values()]),
    byHour: money(byHour),
    topItems: money([...byItem.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)).slice(0, 15),
    byWaiter: money([...byWaiter.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)),
    byType: money([...byType.values()].sort((a, b) => b.orders - a.orders)),
    byStation: stationsConfig.stations.map((s) => {
      const st = stationTimes.get(s.id) || { items: 0, times: [] };
      return {
        station: s.id,
        name: s.name,
        items: round(st.items, 2),
        avgMinutes: st.times.length ? round(avg(st.times), 1) : null,
        medianMinutes: st.times.length ? round(median(st.times), 1) : null,
        warnMinutes: s.warnMinutes,
        lateMinutes: s.lateMinutes,
        lateShare: st.times.length ? round(st.times.filter((m) => m >= s.lateMinutes).length / st.times.length, 3) : null,
      };
    }).concat([...stationTimes.keys()].filter((k) => !stationNames.has(k)).map((k) => ({
      station: k, name: k, items: stationTimes.get(k).items, avgMinutes: round(avg(stationTimes.get(k).times), 1),
    }))),
  };
}

function createStatsRouter({ db, stations, requireRole }) {
  const router = express.Router();
  router.get('/stats', requireRole('admin'), (req, res) => {
    const today = localDate(new Date());
    try {
      res.json(computeStats(db, stations, { from: req.query.from || today, to: req.query.to || today }));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });
  return router;
}

module.exports = { computeStats, createStatsRouter };
