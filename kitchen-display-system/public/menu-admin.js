(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let menu = null;        // το μενού που επεξεργαζόμαστε
  let saved = '';          // JSON της τελευταίας αποθηκευμένης μορφής, για σύγκριση
  let stations = [];
  let defaultStation = '';
  let sel = 0;             // επιλεγμένη κατηγορία

  const toast = KDS.toast;
  const api = KDS.api;

  // ---------- Κατάσταση αλλαγών ----------
  const isDirty = () => menu && JSON.stringify(menu) !== saved;
  function updateDirty() {
    const dirty = isDirty();
    $('saveBtn').disabled = !dirty;
    $('revertBtn').disabled = !dirty;
    const st = $('saveState');
    st.textContent = dirty ? 'Μη αποθηκευμένες αλλαγές' : '';
    st.className = `save-state ${dirty ? 'dirty' : ''}`;
  }
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  const stationName = (id) => stations.find((s) => s.id === id)?.name || id;
  const stationOptions = (value, emptyLabel) =>
    (emptyLabel !== undefined ? `<option value="" ${!value ? 'selected' : ''}>${esc(emptyLabel)}</option>` : '')
    + stations.map((s) => `<option value="${esc(s.id)}" ${s.id === value ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  function move(arr, i, d) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return true;
  }

  // ---------- Απόδοση ----------
  function renderCats() {
    const cats = menu.categories;
    $('catList').innerHTML = cats.map((c, i) => `
      <li class="cat-row ${i === sel ? 'active' : ''}" data-cat="${i}">
        <span class="cname">${esc(c.name || 'Χωρίς όνομα')}</span>
        <span class="ccount">${c.items.length}</span>
        <button class="icon-btn" data-cat-move="-1" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Πάνω">▲</button>
        <button class="icon-btn" data-cat-move="1" data-i="${i}" ${i === cats.length - 1 ? 'disabled' : ''} title="Κάτω">▼</button>
      </li>`).join('');
  }

  function renderEditor() {
    const c = menu.categories[sel];
    if (!c) {
      $('catEditor').innerHTML = '<p class="empty">Δεν υπάρχουν κατηγορίες. Πάτα «+ Νέα κατηγορία».</p>';
      return;
    }
    $('catEditor').innerHTML = `
      <div class="cat-head">
        <label class="field"><span>Όνομα κατηγορίας</span>
          <input class="input" data-cat-field="name" value="${esc(c.name)}" placeholder="π.χ. Σαλάτες"></label>
        <label class="field"><span>Πόστο κουζίνας</span>
          <select class="input" data-cat-field="station">${stationOptions(c.station, `Προεπιλογή (${stationName(defaultStation)})`)}</select></label>
        <button class="btn danger" id="delCat">Διαγραφή κατηγορίας</button>
      </div>
      <div class="items-title"><h3>Είδη (${c.items.length})</h3></div>
      <div id="itemList">${c.items.map(renderItem).join('')}</div>
      <button class="btn add-item" id="addItem">+ Νέο είδος</button>`;
  }

  function renderItem(it, i) {
    const items = menu.categories[sel].items;
    const off = it.available === false;
    return `<div class="item-card ${off ? 'off' : ''}" data-item="${i}">
      <label class="field"><span>Όνομα</span>
        <input class="input" data-field="name" value="${esc(it.name)}" placeholder="Όνομα είδους"></label>
      <label class="field"><span>Τιμή (€)</span>
        <input class="input" data-field="price" inputmode="decimal" value="${typeof it.price === 'number' ? it.price.toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label>
      <label class="field station-field"><span>Πόστο</span>
        <select class="input" data-field="station">${stationOptions(it.station, 'Όπως η κατηγορία')}</select></label>
      <div class="actions">
        <label class="switch" title="Αν το ξεβάλεις, το είδος εμφανίζεται «Εξαντλήθηκε» στο POS">
          <input type="checkbox" data-field="available" ${off ? '' : 'checked'}> Διαθέσιμο</label>
        <button class="icon-btn" data-item-move="-1" ${i === 0 ? 'disabled' : ''} title="Πάνω">▲</button>
        <button class="icon-btn" data-item-move="1" ${i === items.length - 1 ? 'disabled' : ''} title="Κάτω">▼</button>
        <button class="icon-btn danger" data-item-del title="Διαγραφή">✕</button>
      </div>
      <div class="field mods-row"><span>Επιλογές για τον σερβιτόρο</span>
        <div class="mods">
          ${(it.modifiers || []).map((m, mi) => `<span class="mod">${esc(m)}<button data-mod-del="${mi}" title="Αφαίρεση">×</button></span>`).join('')}
          <input class="mod-input" data-mod-add placeholder="+ επιλογή, π.χ. Χωρίς κρεμμύδι ↵">
        </div>
      </div>
    </div>`;
  }

  function render() {
    renderCats();
    renderEditor();
    updateDirty();
  }

  // ---------- Κατηγορίες ----------
  $('catList').addEventListener('click', (e) => {
    const mv = e.target.closest('[data-cat-move]');
    if (mv) {
      const i = Number(mv.dataset.i);
      const d = Number(mv.dataset.catMove);
      if (move(menu.categories, i, d)) { if (sel === i) sel = i + d; else if (sel === i + d) sel = i; render(); }
      return;
    }
    const row = e.target.closest('[data-cat]');
    if (row) { sel = Number(row.dataset.cat); render(); }
  });

  $('addCat').addEventListener('click', () => {
    menu.categories.push({ id: '', name: '', items: [] });
    sel = menu.categories.length - 1;
    render();
    document.querySelector('[data-cat-field="name"]').focus();
  });

  // ---------- Επεξεργασία (με αντιπροσωπεία γεγονότων) ----------
  const editor = $('catEditor');

  editor.addEventListener('input', (e) => {
    const c = menu.categories[sel];
    const t = e.target;
    if (t.dataset.catField === 'name') {
      c.name = t.value;
      t.classList.toggle('invalid', !t.value.trim());
      renderCats();
    } else if (t.dataset.field === 'name' || t.dataset.field === 'price') {
      const it = c.items[Number(t.closest('[data-item]').dataset.item)];
      if (t.dataset.field === 'name') {
        it.name = t.value;
        t.classList.toggle('invalid', !t.value.trim());
      } else {
        const v = t.value.trim().replace(',', '.');
        const n = Number(v);
        t.classList.toggle('invalid', v !== '' && (!Number.isFinite(n) || n < 0));
        if (v === '') delete it.price; else if (Number.isFinite(n)) it.price = n;
      }
    }
    updateDirty();
  });

  editor.addEventListener('change', (e) => {
    const c = menu.categories[sel];
    const t = e.target;
    if (t.dataset.catField === 'station') {
      if (t.value) c.station = t.value; else delete c.station;
    } else if (t.dataset.field === 'station' || t.dataset.field === 'available') {
      const card = t.closest('[data-item]');
      const it = c.items[Number(card.dataset.item)];
      if (t.dataset.field === 'station') {
        if (t.value) it.station = t.value; else delete it.station;
      } else {
        if (t.checked) delete it.available; else it.available = false;
        card.classList.toggle('off', !t.checked);
      }
    }
    updateDirty();
  });

  editor.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.matches('[data-mod-add]') || e.key !== 'Enter') return;
    e.preventDefault();
    const value = t.value.trim();
    if (!value) return;
    const i = Number(t.closest('[data-item]').dataset.item);
    const it = menu.categories[sel].items[i];
    it.modifiers = it.modifiers || [];
    if (!it.modifiers.includes(value)) it.modifiers.push(value);
    renderEditor();
    updateDirty();
    document.querySelector(`[data-item="${i}"] [data-mod-add]`).focus();
  });

  editor.addEventListener('click', (e) => {
    const c = menu.categories[sel];
    const t = e.target;
    if (t.id === 'addItem') {
      c.items.push({ id: '', name: '' });
      render();
      const cards = editor.querySelectorAll('[data-item]');
      cards[cards.length - 1].querySelector('[data-field="name"]').focus();
      return;
    }
    if (t.id === 'delCat') {
      if (!confirm(`Διαγραφή της κατηγορίας «${c.name || 'Χωρίς όνομα'}» και των ${c.items.length} ειδών της;`)) return;
      menu.categories.splice(sel, 1);
      sel = Math.max(0, sel - 1);
      render();
      return;
    }
    const card = t.closest('[data-item]');
    if (!card) return;
    const i = Number(card.dataset.item);
    if (t.matches('[data-item-move]')) {
      if (move(c.items, i, Number(t.dataset.itemMove))) render();
    } else if (t.matches('[data-item-del]')) {
      if (!confirm(`Διαγραφή του «${c.items[i].name || 'Χωρίς όνομα'}»;`)) return;
      c.items.splice(i, 1);
      render();
    } else if (t.matches('[data-mod-del]')) {
      c.items[i].modifiers.splice(Number(t.dataset.modDel), 1);
      if (!c.items[i].modifiers.length) delete c.items[i].modifiers;
      renderEditor();
      updateDirty();
    }
  });

  // ---------- Αποθήκευση / αναίρεση ----------
  function firstProblem() {
    for (const [ci, c] of menu.categories.entries()) {
      if (!c.name.trim()) return { ci, msg: 'Υπάρχει κατηγορία χωρίς όνομα' };
      for (const it of c.items) {
        if (!it.name.trim()) return { ci, msg: `Υπάρχει είδος χωρίς όνομα στην κατηγορία «${c.name}»` };
      }
    }
    return document.querySelector('.input.invalid') ? { ci: sel, msg: 'Διόρθωσε τα πεδία με κόκκινο' } : null;
  }

  async function save() {
    const problem = firstProblem();
    if (problem) {
      sel = problem.ci;
      render();
      for (const el of editor.querySelectorAll('[data-field="name"], [data-cat-field="name"]')) {
        el.classList.toggle('invalid', !el.value.trim());
      }
      toast(problem.msg, 'err');
      return;
    }
    $('saveBtn').disabled = true;
    try {
      const data = await api('PUT', '/api/admin/menu', menu);
      setMenu(data.menu);
      $('saveState').textContent = 'Αποθηκεύτηκε ✓';
      $('saveState').className = 'save-state saved';
      toast('Το μενού αποθηκεύτηκε — τα POS ενημερώθηκαν', 'ok');
    } catch (e) {
      toast(`Σφάλμα: ${e.message}`, 'err');
      updateDirty();
    }
  }
  $('saveBtn').addEventListener('click', save);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (isDirty()) save(); }
  });

  $('revertBtn').addEventListener('click', () => {
    if (!confirm('Να χαθούν οι αλλαγές που δεν αποθηκεύτηκαν;')) return;
    menu = JSON.parse(saved);
    sel = Math.min(sel, Math.max(0, menu.categories.length - 1));
    render();
  });

  function setMenu(m) {
    menu = m;
    saved = JSON.stringify(m);
    sel = Math.min(sel, Math.max(0, menu.categories.length - 1));
    render();
  }

  async function load() {
    try {
      const data = await api('GET', '/api/admin/menu');
      stations = data.stations;
      defaultStation = data.defaultStation;
      setMenu(data.menu);
    } catch (e) {
      toast(`Σφάλμα φόρτωσης: ${e.message}`, 'err');
    }
  }

  KDS.adminNav($('adminNav'));
  load();
})();
