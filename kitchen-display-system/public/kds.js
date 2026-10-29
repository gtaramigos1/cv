(() => {
  const params = new URLSearchParams(location.search);
  const stationId = params.get('station'); // null = επιλογή οθόνης, 'expo' = όλες οι παραγγελίες
  const isExpo = stationId === 'expo';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE_LABEL = { dine_in: 'Τραπέζι', takeaway: 'Πακέτο', delivery: 'Delivery' };

  let stations = [];
  let station = null; // ρυθμίσεις του τρέχοντος station
  const orders = new Map();
  const seen = new Set();
  let audioCtx = null;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const stationQuery = () => (stationId ? `?station=${encodeURIComponent(stationId)}` : '');

  // ---------- Ορατότητα: ίδιοι κανόνες με τον server ----------
  function isVisible(o) {
    if (o.status === 'completed' || o.status === 'cancelled') return false;
    if (isExpo) return true;
    return o.items.some((i) => i.station === stationId && i.status === 'pending');
  }

  function upsert(order) {
    const wasVisible = orders.has(order.id) && isVisible(orders.get(order.id));
    const prev = orders.get(order.id);
    if (isVisible(order)) orders.set(order.id, order);
    else orders.delete(order.id);
    const nowVisible = orders.has(order.id);
    const gotNewItems = prev && order.items.length > prev.items.length;
    if ((nowVisible && !wasVisible) || (nowVisible && gotNewItems)) beep();
  }

  // ---------- Ήχος ----------
  function beep() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    [0, 0.18].forEach((d) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, t + d);
      gain.gain.exponentialRampToValueAtTime(0.001, t + d + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + d);
      osc.stop(t + d + 0.16);
    });
  }

  // ---------- Χρόνοι ----------
  function elapsedMin(o) { return (Date.now() - new Date(o.received_at).getTime()) / 60000; }
  function fmtElapsed(o) {
    const s = Math.max(0, Math.floor((Date.now() - new Date(o.received_at).getTime()) / 1000));
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}h` : `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  function urgency(o) {
    const warn = station ? station.warnMinutes : 10;
    const late = station ? station.lateMinutes : 20;
    const m = elapsedMin(o);
    return m >= late ? 'late' : m >= warn ? 'warn' : 'ok';
  }

  // ---------- Απόδοση ----------
  function renderItem(o, i) {
    const mine = isExpo || i.station === stationId;
    const added = i.added_at > o.received_at && i.status === 'pending';
    const cls = ['item', i.status, mine ? '' : 'other', added ? 'added' : ''].join(' ');
    const qty = Number.isInteger(i.qty) ? i.qty : i.qty.toFixed(2);
    const stationName = isExpo ? (stations.find((s) => s.id === i.station)?.name || i.station) : '';
    return `<li class="${cls}" data-item="${i.id}" data-done="${i.status === 'done'}" data-mine="${mine && i.status !== 'voided'}">
      <div class="line"><span class="qty">${qty}×</span><span>${esc(i.name)}</span>${stationName ? `<span class="station-tag">${esc(stationName)}</span>` : ''}</div>
      ${i.modifiers.length ? `<div class="mods">${i.modifiers.map(esc).join(' · ')}</div>` : ''}
      ${i.notes ? `<div class="note">» ${esc(i.notes)}</div>` : ''}
    </li>`;
  }

  function renderTicket(o, index) {
    // Στα stations δείχνουμε πρώτα τα δικά τους είδη· τα υπόλοιπα αχνά για πλαίσιο.
    const items = isExpo ? o.items : [...o.items].sort((a, b) => (b.station === stationId) - (a.station === stationId));
    const courses = [...new Set(items.map((i) => i.course))];
    let list = '';
    for (const c of courses) {
      if (courses.length > 1) list += `<li class="course">Πιάτο ${c}</li>`;
      list += items.filter((i) => i.course === c).map((i) => renderItem(o, i)).join('');
    }
    const where = o.order_type === 'dine_in' && o.table ? `Τραπ. ${esc(o.table)}` : TYPE_LABEL[o.order_type];
    const cls = ['ticket', urgency(o), o.priority === 'rush' ? 'rush' : '', o.status === 'ready' ? 'ready' : '', seen.has(o.id) ? '' : 'fresh'].join(' ');
    const bumpLabel = isExpo ? (o.status === 'ready' ? 'Σερβιρίστηκε ✓' : 'Ολοκλήρωση') : 'Έτοιμο ✓';
    return `<article class="${cls}" data-order="${o.id}">
      <div class="t-head">
        <div class="t-row"><span><span class="t-index">${index < 9 ? index + 1 : ''}</span><span class="t-no">#${esc(o.external_id)}</span></span><span class="t-timer" data-timer="${o.id}">${fmtElapsed(o)}</span></div>
        <div class="t-meta">${where}${o.customer_name ? ' · ' + esc(o.customer_name) : ''}${o.waiter ? ' · ' + esc(o.waiter) : ''}
          ${o.priority === 'rush' ? '<span class="badge">ΕΠΕΙΓΟΝ</span>' : ''}${o.status === 'ready' ? '<span class="badge">ΕΤΟΙΜΟ</span>' : ''}</div>
      </div>
      ${o.notes ? `<div class="t-notes">${esc(o.notes)}</div>` : ''}
      <ul class="t-items">${list}</ul>
      <div class="t-foot"><button class="btn" data-bump="${o.id}">${bumpLabel}</button></div>
    </article>`;
  }

  function sorted() {
    return [...orders.values()].sort((a, b) => (a.priority === 'rush' ? 0 : 1) - (b.priority === 'rush' ? 0 : 1)
      || a.received_at.localeCompare(b.received_at));
  }

  function render() {
    const list = sorted();
    $('board').innerHTML = list.length ? list.map(renderTicket).join('') : '<div class="empty">Καμία παραγγελία σε αναμονή</div>';
    list.forEach((o) => seen.add(o.id));
    const late = list.filter((o) => urgency(o) === 'late').length;
    $('counts').textContent = `${list.length} παραγγελίες${late ? ` · ${late} καθυστερημένες` : ''}`;
    renderAllDay(list);
  }

  function renderAllDay(list) {
    const totals = new Map();
    for (const o of list) {
      for (const i of o.items) {
        if (i.status !== 'pending' || (!isExpo && i.station !== stationId)) continue;
        totals.set(i.name, (totals.get(i.name) || 0) + i.qty);
      }
    }
    const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    $('allDay').innerHTML = rows.length ? rows.map(([n, q]) => `<span><b>${q}</b>${esc(n)}</span>`).join('') : '<span>—</span>';
  }

  function tick() {
    $('clock').textContent = new Date().toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', hour12: false });
    for (const el of document.querySelectorAll('[data-timer]')) {
      const o = orders.get(Number(el.dataset.timer));
      if (!o) continue;
      el.textContent = fmtElapsed(o);
      const card = el.closest('.ticket');
      const u = urgency(o);
      if (!card.classList.contains(u)) {
        card.classList.remove('ok', 'warn', 'late');
        card.classList.add(u);
      }
    }
  }

  // ---------- Ενέργειες ----------
  async function bump(orderId) {
    try {
      upsert(await api(`/api/orders/${orderId}/bump${stationQuery()}`, { method: 'POST' }));
      render();
    } catch (e) { alert(e.message); }
  }

  $('board').addEventListener('click', async (e) => {
    const bumpBtn = e.target.closest('[data-bump]');
    if (bumpBtn) return bump(Number(bumpBtn.dataset.bump));
    const item = e.target.closest('[data-item]');
    if (item && item.dataset.mine === 'true') {
      try {
        upsert(await api(`/api/items/${item.dataset.item}/toggle`, { method: 'POST', body: { done: item.dataset.done !== 'true' } }));
        render();
      } catch (err) { alert(err.message); }
    }
  });

  // Bump bar / πληκτρολόγιο: 1-9 κάνει bump την αντίστοιχη παραγγελία.
  document.addEventListener('keydown', (e) => {
    if (!station && !isExpo) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const o = sorted()[n - 1];
      if (o) bump(o.id);
    }
  });

  $('btnAllDay').addEventListener('click', () => $('allDay').classList.toggle('hidden'));

  $('btnRecall').addEventListener('click', async () => {
    try {
      const recent = await api(`/api/orders/recent${stationQuery()}`);
      $('recallList').innerHTML = recent.length ? recent.map((o) => `
        <div class="recall-row">
          <div><strong>#${esc(o.external_id)}</strong> ${o.table ? 'Τραπ. ' + esc(o.table) : esc(TYPE_LABEL[o.order_type])}
            <small>${o.items.filter((i) => isExpo || i.station === stationId).map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</small></div>
          <button class="btn" data-recall="${o.id}">Επαναφορά</button>
        </div>`).join('') : '<p class="hint">Δεν υπάρχουν πρόσφατες ολοκληρωμένες παραγγελίες.</p>';
      $('recallOverlay').classList.remove('hidden');
    } catch (e) { alert(e.message); }
  });
  $('recallClose').addEventListener('click', () => $('recallOverlay').classList.add('hidden'));
  $('recallList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-recall]');
    if (!btn) return;
    try {
      upsert(await api(`/api/orders/${btn.dataset.recall}/recall${stationQuery()}`, { method: 'POST' }));
      $('recallOverlay').classList.add('hidden');
      render();
    } catch (err) { alert(err.message); }
  });

  $('startBtn').addEventListener('click', () => {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* χωρίς ήχο */ }
    document.documentElement.requestFullscreen?.().catch(() => {});
    $('startOverlay').classList.add('hidden');
  });

  // ---------- Σύνδεση σε πραγματικό χρόνο ----------
  async function loadSnapshot() {
    const list = await api(`/api/orders${stationQuery()}`);
    orders.clear();
    list.forEach((o) => { orders.set(o.id, o); seen.add(o.id); });
    render();
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { $('conn').classList.add('on'); loadSnapshot().catch(console.error); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'order') { upsert(msg.order); render(); }
    };
    ws.onclose = () => { $('conn').classList.remove('on'); setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
  }

  async function init() {
    ({ stations } = await api('/api/config'));
    if (!stationId) {
      $('startOverlay').classList.add('hidden');
      $('board').classList.add('hidden');
      document.querySelector('.actions').classList.add('hidden');
      $('picker').classList.remove('hidden');
      $('pickerGrid').innerHTML = stations.map((s) => `<a class="btn" href="?station=${encodeURIComponent(s.id)}">${esc(s.name)}</a>`).join('')
        + '<a class="btn ghost" href="?station=expo">Expo (πάσο)</a>'
        + '<a class="btn ghost" href="/pos">Λήψη παραγγελιών</a>';
      return;
    }
    station = stations.find((s) => s.id === stationId) || null;
    if (!station && !isExpo) {
      document.body.innerHTML = `<p class="empty">Άγνωστο station "${esc(stationId)}". <a href="/">Επιλογή οθόνης</a></p>`;
      return;
    }
    $('stationName').textContent = isExpo ? 'Expo / Πάσο' : station.name;
    document.title = `KDS · ${$('stationName').textContent}`;
    connect();
    setInterval(tick, 1000);
    tick();
  }

  init().catch((e) => { document.body.innerHTML = `<p class="empty">Σφάλμα: ${esc(e.message)}</p>`; });
})();
