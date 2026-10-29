// Κοινά για όλες τις σελίδες: σύνδεση χρήστη, κλήσεις API, ειδοποιήσεις, πλοήγηση διαχείρισης.
window.KDS = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toLogin() {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }

  // Η συνεδρία έληξε ή αποσυνδέθηκε από αλλού → πίσω στη σύνδεση.
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.loginRequired) {
      toLogin();
      throw new Error(data.error);
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  let mePromise = null;
  const me = () => (mePromise ||= api('GET', '/api/auth/me'));

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  }

  function toast(text, kind = '', ms) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms || (kind === 'ok' ? 6000 : 3500));
  }

  // Μετά από διακοπή του WebSocket: αν η αιτία είναι η σύνδεση χρήστη, πήγαινε στο login.
  async function checkSession() {
    const res = await fetch('/api/auth/me').catch(() => null);
    if (res && res.status === 401) toLogin();
  }

  // Γραμμή πλοήγησης για τις σελίδες διαχείρισης.
  const ADMIN_LINKS = [
    ['/admin/stats', 'Στατιστικά'],
    ['/admin/menu', 'Μενού'],
    ['/admin/users', 'Χρήστες'],
    ['/pos', 'POS'],
    ['/', 'KDS'],
  ];
  async function adminNav(el) {
    el.innerHTML = ADMIN_LINKS.map(([href, label]) =>
      `<a class="nav-link ${location.pathname === href ? 'active' : ''}" href="${href}">${label}</a>`).join('')
      + '<button class="nav-link logout" type="button">Αποσύνδεση</button>';
    el.querySelector('.logout').addEventListener('click', logout);
    const { user } = await me();
    el.querySelector('.logout').title = `Συνδεδεμένος: ${user.name}`;
  }

  return { esc, api, me, logout, toast, checkSession, adminNav, toLogin };
})();
