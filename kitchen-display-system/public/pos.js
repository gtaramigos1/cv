(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE_LABEL = { dine_in: 'Τραπέζι', takeaway: 'Πακέτο', delivery: 'Delivery' };
  const STATUS_LABEL = { new: 'Σε αναμονή', in_progress: 'Ετοιμάζεται', ready: 'ΕΤΟΙΜΟ', completed: 'Σερβιρίστηκε', cancelled: 'Ακυρώθηκε' };
  const COURSE_LABEL = { 1: '', 2: 'Μετά', 3: 'Στο τέλος' };


  let menu = { currency: '€', categories: [] };
  const menuById = new Map();
  let activeCat = null;
  let orderType = 'dine_in';
  let cart = []; // { key, menuId, qty, modifiers: [], notes, course }
  let editing = null;
  const orders = new Map();
  let audioCtx = null;
  let me = null; // συνδεδεμένος χρήστης

  const money = (n) => `${n.toFixed(2).replace('.', ',')} ${menu.currency || '€'}`;

  async function api(path, body) {
    const res = await fetch(path, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : undefined);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.loginRequired) KDS.toLogin();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'ok' ? 6000 : 3500);
  }

  function beep() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    [0, 0.15, 0.3].forEach((d, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = [660, 880, 1100][i];
      gain.gain.setValueAtTime(0.2, t + d);
      gain.gain.exponentialRampToValueAtTime(0.001, t + d + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + d);
      osc.stop(t + d + 0.15);
    });
  }
  document.addEventListener('pointerdown', () => {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* χωρίς ήχο */ }
  }, { once: true });

  // ---------- Μενού ----------
  function renderCats() {
    $('cats').innerHTML = menu.categories.map((c) =>
      `<button class="cat ${c.id === activeCat ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
  }

  function renderItems() {
    const cat = menu.categories.find((c) => c.id === activeCat);
    const counts = new Map();
    for (const l of cart) counts.set(l.menuId, (counts.get(l.menuId) || 0) + l.qty);
    $('items').innerHTML = (cat ? cat.items : []).map((it) => {
      const out = it.available === false;
      return `<button class="item-btn ${out ? 'soldout' : ''}" data-add="${esc(it.id)}" ${out ? 'disabled' : ''}>
        ${counts.get(it.id) ? `<span class="count">${counts.get(it.id)}</span>` : ''}
        <span class="name">${esc(it.name)}</span>
        <span class="price">${out ? 'Εξαντλήθηκε' : typeof it.price === 'number' ? money(it.price) : ''}</span>
      </button>`;
    }).join('');
  }

  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    activeCat = b.dataset.cat;
    renderCats();
    renderItems();
  });

  $('items').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (b) addItem(b.dataset.add);
  });

  // ---------- Καλάθι ----------
  let keySeq = 0;
  function addItem(menuId) {
    // Ίδιο είδος χωρίς επιλογές/σημειώσεις → αυξάνεται η ποσότητα αντί για νέα γραμμή.
    const plain = cart.find((l) => l.menuId === menuId && !l.modifiers.length && !l.notes && l.course === 1);
    if (plain) plain.qty += 1;
    else cart.push({ key: ++keySeq, menuId, qty: 1, modifiers: [], notes: '', course: 1 });
    renderCart();
  }

  function lineTotal(l) {
    const price = menuById.get(l.menuId)?.price;
    return typeof price === 'number' ? price * l.qty : 0;
  }

  function renderCart() {
    const total = cart.reduce((s, l) => s + lineTotal(l), 0);
    const count = cart.reduce((s, l) => s + l.qty, 0);
    $('lines').innerHTML = cart.length ? cart.map((l) => {
      const it = menuById.get(l.menuId);
      return `<li class="line" data-line="${l.key}">
        <span class="qty">${l.qty}×</span>
        <div class="body">
          <div class="title">${esc(it?.name || l.menuId)}</div>
          ${l.modifiers.length ? `<div class="sub">${l.modifiers.map(esc).join(' · ')}</div>` : ''}
          ${l.notes ? `<div class="note">» ${esc(l.notes)}</div>` : ''}
          ${COURSE_LABEL[l.course] ? `<div class="course">Σερβίρισμα: ${COURSE_LABEL[l.course]}</div>` : ''}
        </div>
        <span class="amount">${money(lineTotal(l))}</span>
        <button class="plus" data-plus="${l.key}" aria-label="Ένα ακόμα">+</button>
      </li>`;
    }).join('') : '<li class="empty">Πάτησε είδη από το μενού για να τα προσθέσεις</li>';
    $('total').textContent = money(total);
    $('cartBarCount').textContent = `Καλάθι (${count})`;
    $('cartBarTotal').textContent = money(total);
    $('sendBtn').disabled = cart.length === 0;
    renderItems();
  }

  $('lines').addEventListener('click', (e) => {
    const plus = e.target.closest('[data-plus]');
    if (plus) {
      const l = cart.find((x) => x.key === Number(plus.dataset.plus));
      if (l) { l.qty += 1; renderCart(); }
      return;
    }
    const li = e.target.closest('[data-line]');
    if (li) openLine(Number(li.dataset.line));
  });

  // ---------- Επεξεργασία γραμμής ----------
  function openLine(key) {
    const l = cart.find((x) => x.key === key);
    if (!l) return;
    const it = menuById.get(l.menuId);
    editing = { ...l, modifiers: [...l.modifiers] };
    $('ldName').textContent = it?.name || l.menuId;
    $('ldQty').textContent = editing.qty;
    $('ldNotes').value = editing.notes;
    const options = [...new Set([...(it?.modifiers || []), ...editing.modifiers])];
    $('ldMods').innerHTML = options.length
      ? options.map((m) => `<button class="chip ${editing.modifiers.includes(m) ? 'on' : ''}" data-mod="${esc(m)}">${esc(m)}</button>`).join('')
      : '<span class="none">Δεν υπάρχουν επιλογές — γράψε σημείωση</span>';
    setSeg($('ldCourse'), 'course', String(editing.course));
    $('lineDialog').classList.remove('hidden');
  }

  function closeLine() {
    editing = null;
    $('lineDialog').classList.add('hidden');
  }

  $('ldMods').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-mod]');
    if (!chip) return;
    const m = chip.dataset.mod;
    const i = editing.modifiers.indexOf(m);
    if (i >= 0) editing.modifiers.splice(i, 1); else editing.modifiers.push(m);
    chip.classList.toggle('on');
  });
  document.querySelector('.stepper').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    editing.qty = Math.max(1, editing.qty + Number(b.dataset.step));
    $('ldQty').textContent = editing.qty;
  });
  $('ldCourse').addEventListener('click', (e) => {
    const b = e.target.closest('[data-course]');
    if (!b) return;
    editing.course = Number(b.dataset.course);
    setSeg($('ldCourse'), 'course', b.dataset.course);
  });
  $('ldDone').addEventListener('click', () => {
    const l = cart.find((x) => x.key === editing.key);
    if (l) Object.assign(l, editing, { notes: $('ldNotes').value.trim() });
    closeLine();
    renderCart();
  });
  $('ldRemove').addEventListener('click', () => {
    cart = cart.filter((x) => x.key !== editing.key);
    closeLine();
    renderCart();
  });
  $('lineDialog').addEventListener('click', (e) => { if (e.target.id === 'lineDialog') closeLine(); });

  // ---------- Τύπος παραγγελίας ----------
  function setSeg(seg, attr, value) {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset[attr] === value);
  }
  $('orderType').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    orderType = b.dataset.type;
    setSeg($('orderType'), 'type', orderType);
    $('table').classList.toggle('hidden', orderType !== 'dine_in');
    $('customer').classList.toggle('hidden', orderType === 'dine_in');
  });
  $('table').addEventListener('input', () => $('table').classList.remove('invalid'));

  // ---------- Αποστολή ----------
  function resetOrder() {
    cart = [];
    $('table').value = '';
    $('customer').value = '';
    $('orderNotes').value = '';
    $('rush').checked = false;
    renderCart();
  }

  $('clearBtn').addEventListener('click', () => {
    if (cart.length && !confirm('Να αδειάσει το καλάθι;')) return;
    resetOrder();
  });

  $('sendBtn').addEventListener('click', async () => {
    if (!cart.length) return;
    if (orderType === 'dine_in' && !$('table').value.trim()) {
      $('table').classList.add('invalid');
      $('table').focus();
      toast('Συμπλήρωσε αριθμό τραπεζιού', 'err');
      return;
    }
    $('sendBtn').disabled = true;
    try {
      const order = await api('/api/pos/orders', {
        order_type: orderType,
        table: $('table').value.trim(),
        customer_name: $('customer').value.trim(),
        notes: $('orderNotes').value.trim(),
        priority: $('rush').checked ? 'rush' : 'normal',
        items: cart.map((l) => ({ menu_id: l.menuId, qty: l.qty, modifiers: l.modifiers, notes: l.notes, course: l.course })),
      });
      orders.set(order.id, order);
      renderOrders();
      toast(`Η παραγγελία #${order.external_id} στάλθηκε στην κουζίνα`, 'ok');
      resetOrder();
      $('cart').classList.remove('open');
    } catch (e) {
      toast(`Σφάλμα: ${e.message}`, 'err');
    } finally {
      $('sendBtn').disabled = cart.length === 0;
    }
  });

  // Κινητό: το καλάθι ανοίγει σε πλήρη οθόνη.
  $('cartBar').addEventListener('click', () => $('cart').classList.add('open'));
  $('closeCart').addEventListener('click', () => $('cart').classList.remove('open'));

  // ---------- Παραγγελίες ----------
  const where = (o) => (o.order_type === 'dine_in' && o.table ? `Τραπέζι ${esc(o.table)}` : `${TYPE_LABEL[o.order_type]}${o.customer_name ? ' · ' + esc(o.customer_name) : ''}`);
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

  function renderOrderCard(o) {
    const canCancel = me?.role === 'admin' && (o.status === 'new' || o.status === 'in_progress');
    return `<article class="ocard ${o.status === 'ready' ? 'ready' : ''}">
      <div class="ocard-head">
        <div><div class="no">#${esc(o.external_id)}</div><div class="meta">${where(o)}${o.waiter ? ' · ' + esc(o.waiter) : ''}</div></div>
        <span class="status ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
      </div>
      <ul>${o.items.map((i) => `<li class="${i.status}"><b>${i.qty}×</b> ${esc(i.name)}</li>`).join('')}</ul>
      <div class="ocard-foot">
        <span>${time(o.received_at)}${o.ready_at ? ` → έτοιμο ${time(o.ready_at)}` : ''}</span>
        ${canCancel ? `<button class="btn danger" data-cancel="${esc(o.external_id)}">Ακύρωση</button>` : ''}
      </div>
    </article>`;
  }

  function renderOrders() {
    const list = [...orders.values()];
    const open = list.filter((o) => ['new', 'in_progress', 'ready'].includes(o.status))
      .sort((a, b) => (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || a.received_at.localeCompare(b.received_at));
    const closed = list.filter((o) => !open.includes(o)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 12);
    $('activeCount').textContent = open.length;
    $('ordersList').innerHTML = (open.length ? open.map(renderOrderCard).join('') : '<div class="empty">Δεν υπάρχουν ανοιχτές παραγγελίες</div>')
      + (closed.length ? '<div class="section-title">Πρόσφατες</div>' + closed.map(renderOrderCard).join('') : '');
  }

  $('ordersList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cancel]');
    if (!b || !confirm(`Ακύρωση της παραγγελίας #${b.dataset.cancel};`)) return;
    try {
      const o = await api(`/api/pos/orders/${encodeURIComponent(b.dataset.cancel)}/cancel`, {});
      orders.set(o.id, o);
      renderOrders();
    } catch (err) { toast(`Σφάλμα: ${err.message}`, 'err'); }
  });

  function onOrderUpdate(o) {
    const prev = orders.get(o.id);
    orders.set(o.id, o);
    if (o.status === 'ready' && prev && prev.status !== 'ready') {
      toast(`ΕΤΟΙΜΟ: #${o.external_id} · ${o.order_type === 'dine_in' && o.table ? 'Τραπέζι ' + o.table : TYPE_LABEL[o.order_type]}`, 'ok');
      beep();
    }
    renderOrders();
  }

  async function loadOrders() {
    const [active, recent] = await Promise.all([api('/api/orders'), api('/api/orders/recent')]);
    for (const o of [...active, ...recent]) orders.set(o.id, o);
    renderOrders();
  }

  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { $('conn').classList.add('on'); loadOrders().catch(console.error); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'order') onOrderUpdate(msg.order);
      if (msg.type === 'menu') loadMenu().catch(console.error);
    };
    ws.onclose = () => {
      $('conn').classList.remove('on');
      KDS.checkSession();
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
  }

  // ---------- Καρτέλες ----------
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-view]');
    if (!t) return;
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b === t);
    $('viewNew').classList.toggle('hidden', t.dataset.view !== 'new');
    $('viewOrders').classList.toggle('hidden', t.dataset.view !== 'orders');
  });

  $('logoutBtn').addEventListener('click', () => {
    if (cart.length && !confirm('Το καλάθι δεν έχει σταλεί. Αποσύνδεση;')) return;
    KDS.logout();
  });

  async function loadMenu() {
    menu = await api('/api/pos/menu');
    menuById.clear();
    for (const c of menu.categories) for (const it of c.items) menuById.set(it.id, it);
    if (!menu.categories.some((c) => c.id === activeCat)) activeCat = menu.categories[0]?.id || null;
    // Είδη του καλαθιού που αφαιρέθηκαν ή εξαντλήθηκαν στο μεταξύ βγαίνουν από το καλάθι.
    const gone = cart.filter((l) => !menuById.has(l.menuId) || menuById.get(l.menuId).available === false);
    if (gone.length) {
      cart = cart.filter((l) => !gone.includes(l));
      toast(`Αφαιρέθηκαν από το καλάθι (μη διαθέσιμα): ${gone.map((l) => menuById.get(l.menuId)?.name || l.menuId).join(', ')}`, 'err');
    }
    renderCats();
    renderCart();
  }

  async function init() {
    ({ user: me } = await KDS.me());
    $('userName').textContent = me.name;
    if (me.role === 'admin') $('menuLink').classList.remove('hidden');
    await loadMenu();
    connect();
  }

  init().catch((e) => toast(`Σφάλμα φόρτωσης μενού: ${e.message}`, 'err'));
})();
