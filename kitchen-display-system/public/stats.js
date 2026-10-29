(() => {
  const { esc, api, toast } = KDS;
  const $ = (id) => document.getElementById(id);
  const TYPE_LABEL = { dine_in: 'Τραπέζι', takeaway: 'Πακέτο', delivery: 'Delivery' };
  const DAYS = ['Κυρ', 'Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ'];

  const nf0 = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1 });
  const eur = (n) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);
  const compact = (n) => (n >= 1000 ? `${nf1.format(n / 1000)}K` : nf0.format(n));
  const mins = (m) => (m === null || m === undefined ? '—' : `${nf1.format(m)}′`);

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  function presetRange(p) {
    const t = new Date();
    if (p === 'today') return [t, t];
    if (p === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
    if (p === 'month') return [new Date(t.getFullYear(), t.getMonth(), 1), t];
    return [addDays(t, -(Number(p) - 1)), t];
  }

  // ---------- Tooltip (ποντίκι και πληκτρολόγιο) ----------
  const tip = $('tooltip');
  function showTip(el, value, label) {
    $('ttValue').textContent = value;
    $('ttLabel').textContent = label;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
  }
  const hideTip = () => tip.classList.add('hidden');
  document.addEventListener('scroll', hideTip, true);

  // Καθαροί άξονες: 0 και 3–4 στρογγυλές τιμές.
  function niceScale(max) {
    if (max <= 0) return { top: 1, ticks: [0, 1] };
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return { top, ticks };
  }

  // Ραβδόγραμμα στηλών μίας σειράς. rows: [{label, value, tip, tipLabel}]
  function columnChart(el, rows, { format = compact, labelEvery = 1 } = {}) {
    const max = Math.max(0, ...rows.map((r) => r.value));
    const { top, ticks } = niceScale(max);
    el.innerHTML = `
      <div class="cols">
        ${ticks.map((t) => `<div class="gridline" style="bottom:${(t / top) * 100}%"></div>
          <span class="tick" style="bottom:${(t / top) * 100}%;transform:translateY(50%)">${format(t)}</span>`).join('')}
        <div class="slots">
          ${rows.map((r, i) => `<button class="slot" data-i="${i}" aria-label="${esc(r.tipLabel)}: ${esc(r.tip)}">
            ${r.value > 0 ? `<span class="bar" style="height:${(r.value / top) * 100}%"></span>` : ''}
          </button>`).join('')}
        </div>
      </div>
      <div class="xlabels">${rows.map((r, i) => `<span>${i % labelEvery === 0 ? esc(r.label) : ''}</span>`).join('')}</div>`;
    // Οι χειριστές μπαίνουν μία φορά· διαβάζουν πάντα τα τρέχοντα δεδομένα του γραφήματος.
    el.chartRows = rows;
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    const onEnter = (e) => {
      const slot = e.target.closest('.slot');
      const r = slot && el.chartRows[Number(slot.dataset.i)];
      if (r) showTip(slot, r.tip, r.tipLabel);
    };
    el.addEventListener('pointerover', onEnter);
    el.addEventListener('focusin', onEnter);
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focusout', hideTip);
  }

  function table(headers, rows) {
    return `<table><thead><tr>${headers.map(([h, num]) => `<th class="${num ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${headers[i][1] ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // Οριζόντιες μπάρες μίας σειράς: τιμή στην άκρη της μπάρας, λεπτομέρειες σε δεύτερη γραμμή.
  function hbars(rows) {
    const max = Math.max(0, ...rows.map((r) => r.value));
    return `<div class="hbars">${rows.map((r) => `
      <div class="hrow">
        <span class="name" title="${esc(r.name)}">${esc(r.name)}</span>
        <span class="track">
          ${r.value > 0 ? `<span class="hbar" style="width:calc((100% - 4.5rem) * ${max ? r.value / max : 0})"></span>` : ''}
          <span class="val">${r.valueText}</span>
        </span>
        ${r.extra ? `<span class="extra">${r.extra}</span>` : ''}
      </div>`).join('')}</div>`;
  }

  // ---------- Απόδοση ----------
  function render(s) {
    const t = s.totals;
    const multiDay = s.byDay.length > 1;
    $('kpis').innerHTML = `
      <div class="kpi hero"><span class="label">Τζίρος</span><span class="value">${eur(t.revenue)}</span>
        <span class="sub">${multiDay ? `${s.byDay.length} ημέρες · ${eur(t.revenue / s.byDay.length)} / ημέρα` : 'χωρίς ακυρωμένες'}</span></div>
      <div class="kpi"><span class="label">Παραγγελίες</span><span class="value">${nf0.format(t.orders)}</span>
        <span class="sub">${nf0.format(t.items)} είδη</span></div>
      <div class="kpi"><span class="label">Μέση παραγγελία</span><span class="value">${eur(t.avgOrderValue)}</span></div>
      <div class="kpi"><span class="label">Χρόνος ετοιμασίας</span><span class="value">${mins(t.avgPrepMinutes)}</span>
        <span class="sub">διάμεσος ${mins(t.medianPrepMinutes)}</span></div>
      <div class="kpi"><span class="label">Ακυρώσεις</span><span class="value">${nf0.format(t.cancelled)}</span>
        <span class="sub">${t.orders + t.cancelled ? `${nf1.format((t.cancelled / (t.orders + t.cancelled)) * 100)}% των παραγγελιών` : '—'}</span></div>`;

    $('note').classList.toggle('hidden', !t.unpricedItems);
    $('note').textContent = t.unpricedItems
      ? `${t.unpricedItems} είδη χωρίς τιμή (π.χ. από το ERP ή πριν μπουν τιμές) δεν μετράνε στον τζίρο.` : '';

    // Ώρες: μόνο το εύρος με κίνηση (±1 ώρα), για να μη χάνονται οι μπάρες σε 24 στήλες.
    const active = s.byHour.filter((h) => h.orders > 0).map((h) => h.hour);
    if (!active.length) {
      $('hourChart').innerHTML = '<p class="empty">Δεν υπάρχουν παραγγελίες σε αυτό το διάστημα</p>';
      $('hourTable').innerHTML = '';
      $('hourSub').textContent = '';
    } else {
      const from = Math.max(0, Math.min(...active) - 1);
      const to = Math.min(23, Math.max(...active) + 1);
      const hours = s.byHour.slice(from, to + 1);
      const peak = hours.reduce((a, b) => (b.orders > a.orders ? b : a));
      $('hourSub').textContent = `αιχμή ${pad(peak.hour)}:00–${pad((peak.hour + 1) % 24)}:00`;
      columnChart($('hourChart'), hours.map((h) => ({
        label: pad(h.hour), value: h.orders,
        tip: `${nf0.format(h.orders)} παραγγελίες · ${eur(h.revenue)}`, tipLabel: `${pad(h.hour)}:00–${pad((h.hour + 1) % 24)}:00`,
      })), { labelEvery: hours.length > 14 ? 2 : 1 });
      $('hourTable').innerHTML = table([['Ώρα'], ['Παραγγελίες', 1], ['Τζίρος', 1]],
        hours.map((h) => [`${pad(h.hour)}:00`, nf0.format(h.orders), eur(h.revenue)]));
    }

    $('dayCard').classList.toggle('hidden', !multiDay);
    if (multiDay) {
      // Πλήρης ετικέτα («Παρ 23») μόνο όταν χωράει· αλλιώς μόνο ο αριθμός της ημέρας.
      const roomy = $('dayChart').clientWidth / s.byDay.length >= 64;
      columnChart($('dayChart'), s.byDay.map((d) => {
        const date = new Date(`${d.date}T12:00:00`);
        return {
          label: roomy ? `${DAYS[date.getDay()]} ${date.getDate()}` : String(date.getDate()),
          value: d.revenue,
          tip: `${eur(d.revenue)} · ${nf0.format(d.orders)} παραγγελίες`,
          tipLabel: date.toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' }),
        };
      }), { format: (v) => compact(v), labelEvery: Math.max(1, Math.ceil(s.byDay.length / Math.max(1, Math.floor($('dayChart').clientWidth / 34)))) });
      $('dayTable').innerHTML = table([['Ημέρα'], ['Παραγγελίες', 1], ['Τζίρος', 1]],
        s.byDay.map((d) => [new Date(`${d.date}T12:00:00`).toLocaleDateString('el-GR', { weekday: 'short', day: 'numeric', month: 'short' }), nf0.format(d.orders), eur(d.revenue)]));
    }

    const st = s.byStation.filter((x) => x.items > 0);
    $('stations').innerHTML = st.length ? hbars(st.map((x) => ({
      name: x.name,
      value: x.avgMinutes || 0,
      valueText: mins(x.avgMinutes),
      extra: `${nf0.format(x.items)} είδη${x.lateShare ? ` · <span class="late">⚠ ${nf0.format(x.lateShare * 100)}% πάνω από ${x.lateMinutes}′</span>` : ''}`,
    }))) : '<p class="empty">Δεν υπάρχουν ολοκληρωμένα είδη ακόμα</p>';

    $('topItems').innerHTML = s.topItems.length ? hbars(s.topItems.slice(0, 10).map((x) => ({
      name: x.name, value: x.qty, valueText: nf0.format(x.qty), extra: x.revenue ? eur(x.revenue) : '',
    }))) : '<p class="empty">—</p>';

    $('waiters').innerHTML = s.byWaiter.length ? table([['Σερβιτόρος'], ['Παραγγελίες', 1], ['Τζίρος', 1], ['Μέση', 1]],
      s.byWaiter.map((w) => [esc(w.waiter), nf0.format(w.orders), eur(w.revenue), eur(w.orders ? w.revenue / w.orders : 0)]))
      : '<p class="empty">—</p>';

    $('types').innerHTML = s.byType.length ? table([['Τύπος'], ['Παραγγελίες', 1], ['Τζίρος', 1], ['Μερίδιο', 1]],
      s.byType.map((x) => [TYPE_LABEL[x.type] || esc(x.type), nf0.format(x.orders), eur(x.revenue),
        `${nf0.format(t.orders ? (x.orders / t.orders) * 100 : 0)}%`]))
      : '<p class="empty">—</p>';
  }

  // ---------- Φόρτωση ----------
  let seq = 0;
  async function load() {
    const from = $('from').value;
    const to = $('to').value;
    if (!from || !to) return;
    const mine = ++seq;
    $('wrap').classList.add('loading'); // κρατά το προηγούμενο γράφημα αχνό, χωρίς «άλμα»
    try {
      const s = await api('GET', `/api/stats?from=${from}&to=${to}`);
      if (mine === seq) render(s);
    } catch (e) {
      toast(`Σφάλμα: ${e.message}`, 'err');
    } finally {
      if (mine === seq) $('wrap').classList.remove('loading');
    }
  }

  function setPreset(p) {
    const [a, b] = presetRange(p);
    $('from').value = iso(a);
    $('to').value = iso(b);
    for (const btn of $('presets').querySelectorAll('button')) btn.classList.toggle('on', btn.dataset.preset === p);
    load();
  }

  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b) setPreset(b.dataset.preset);
  });
  for (const id of ['from', 'to']) {
    $(id).addEventListener('change', () => {
      for (const btn of $('presets').querySelectorAll('button')) btn.classList.remove('on');
      if ($('from').value > $('to').value) $(id === 'from' ? 'to' : 'from').value = $(id).value;
      load();
    });
  }

  KDS.adminNav($('adminNav'));
  setPreset('today');
})();
