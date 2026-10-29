// Χρήστες, σύνδεση με PIN και έλεγχος πρόσβασης ανά ρόλο.
//
// Κάθε χρήστης έχει μοναδικό PIN. Το PIN δεν αποθηκεύεται· κρατάμε μόνο HMAC του με μυστικό
// κλειδί του server, ώστε η σύνδεση να γίνεται μόνο με το PIN (χωρίς όνομα χρήστη).
// Επειδή τα PIN είναι λίγα ψηφία, η προστασία από μαντεψιές γίνεται με όριο αποτυχιών ανά IP.

const crypto = require('crypto');
const express = require('express');

const ROLES = {
  admin: 'Διαχειριστής',
  waiter: 'Σερβιτόρος',
  kitchen: 'Κουζίνα',
};
const COOKIE = 'kds_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCK_MINUTES = 10;

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth({ db, secret }) {
  if (!secret) throw new Error('Λείπει το μυστικό κλειδί για τη σύνδεση χρηστών');
  const pinKey = (pin) => crypto.createHmac('sha256', secret).update(`pin:${pin}`).digest('hex');

  const q = {
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    list: db.prepare('SELECT id, name, role, active, created_at FROM users ORDER BY active DESC, name'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    byPin: db.prepare('SELECT * FROM users WHERE pin_key = ?'),
    insert: db.prepare('INSERT INTO users (name, role, pin_key, active, created_at) VALUES (?, ?, ?, 1, ?)'),
    update: db.prepare('UPDATE users SET name = ?, role = ?, pin_key = ?, active = ? WHERE id = ?'),
    activeAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?"),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(`SELECT s.token_hash, s.expires_at, u.id, u.name, u.role, u.active
                         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`),
    touchSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  // ---------- Χρήστες ----------
  function validate({ name, role, pin }, { pinRequired }) {
    const n = String(name ?? '').trim();
    if (!n) throw new AuthError(400, 'Συμπλήρωσε όνομα');
    if (n.length > 40) throw new AuthError(400, 'Το όνομα είναι πολύ μεγάλο');
    if (!ROLES[role]) throw new AuthError(400, 'Άγνωστος ρόλος');
    const p = pin === undefined || pin === null ? '' : String(pin).trim();
    if (p || pinRequired) {
      if (!/^\d{4,8}$/.test(p)) throw new AuthError(400, 'Το PIN πρέπει να έχει 4 έως 8 ψηφία');
    }
    return { name: n, role, pin: p };
  }

  function assertPinFree(pin, exceptId) {
    const other = q.byPin.get(pinKey(pin));
    if (other && other.id !== exceptId) throw new AuthError(409, 'Αυτό το PIN χρησιμοποιείται ήδη από άλλον χρήστη');
  }

  const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, active: Boolean(u.active) });

  function createUser(input) {
    const { name, role, pin } = validate(input, { pinRequired: true });
    assertPinFree(pin);
    const { lastInsertRowid } = q.insert.run(name, role, pinKey(pin), now());
    return publicUser(q.byId.get(lastInsertRowid));
  }

  const updateUserTx = db.transaction((id, input) => {
    const user = q.byId.get(id);
    if (!user) throw new AuthError(404, 'Ο χρήστης δεν βρέθηκε');
    const { name, role, pin } = validate({
      name: input.name ?? user.name,
      role: input.role ?? user.role,
      pin: input.pin,
    }, { pinRequired: false });
    const active = input.active === undefined ? Boolean(user.active) : Boolean(input.active);
    const losesAdmin = user.role === 'admin' && user.active && (role !== 'admin' || !active);
    if (losesAdmin && q.activeAdmins.get(id).n === 0) {
      throw new AuthError(409, 'Πρέπει να υπάρχει τουλάχιστον ένας ενεργός διαχειριστής');
    }
    if (pin) assertPinFree(pin, id);
    q.update.run(name, role, pin ? pinKey(pin) : user.pin_key, active ? 1 : 0, id);
    // Νέο PIN, απενεργοποίηση ή αλλαγή ρόλου → αποσύνδεση από όλες τις συσκευές.
    if (pin || !active || role !== user.role) q.deleteUserSessions.run(id);
    return publicUser(q.byId.get(id));
  });

  const listUsers = () => q.list.all().map(publicUser);

  // Δημιουργεί τον πρώτο διαχειριστή όταν η βάση δεν έχει κανέναν χρήστη.
  function ensureInitialAdmin(initialPin) {
    if (q.count.get().n > 0) return null;
    const pin = initialPin || String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    createUser({ name: 'Διαχειριστής', role: 'admin', pin });
    return pin;
  }

  // ---------- Όριο αποτυχημένων προσπαθειών ----------
  const failures = new Map(); // ip → { count, lockedUntil }
  function checkLock(ip) {
    const f = failures.get(ip);
    if (f && f.lockedUntil > Date.now()) {
      const min = Math.ceil((f.lockedUntil - Date.now()) / 60000);
      throw new AuthError(429, `Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε ${min}′`);
    }
  }
  function recordFailure(ip) {
    const f = failures.get(ip) || { count: 0, lockedUntil: 0 };
    if (f.lockedUntil && f.lockedUntil <= Date.now()) f.count = 0;
    f.count += 1;
    if (f.count >= MAX_FAILURES) f.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
    failures.set(ip, f);
  }

  // ---------- Συνεδρίες ----------
  function login(pin, ip) {
    checkLock(ip);
    const user = /^\d{4,8}$/.test(String(pin ?? '')) ? q.byPin.get(pinKey(String(pin))) : null;
    if (!user || !user.active) {
      recordFailure(ip);
      throw new AuthError(401, 'Λάθος PIN');
    }
    failures.delete(ip);
    q.purgeSessions.run(now());
    const token = crypto.randomBytes(32).toString('base64url');
    q.insertSession.run(sha256(token), user.id, now(), new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
    return { token, user: publicUser(user) };
  }

  function userFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const hash = sha256(token);
    const s = q.session.get(hash);
    if (!s || !s.active || s.expires_at < now()) return null;
    // Συρόμενη λήξη: οι συσκευές που χρησιμοποιούνται μένουν συνδεδεμένες.
    const remaining = new Date(s.expires_at).getTime() - Date.now();
    if (remaining < (SESSION_DAYS - 1) * 86400000) {
      q.touchSession.run(new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), hash);
    }
    return { id: s.id, name: s.name, role: s.role, sessionHash: hash };
  }

  function setCookie(req, res, token) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
  const clearCookie = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

  // ---------- Middleware ----------
  function attachUser(req, res, next) {
    req.user = userFromRequest(req);
    next();
  }

  // Για API: 401 αν δεν υπάρχει σύνδεση, 403 αν ο ρόλος δεν επιτρέπεται.
  const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Απαιτείται σύνδεση', loginRequired: true });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Δεν έχεις δικαίωμα για αυτή την ενέργεια' });
    }
    next();
  };

  // Για σελίδες: ανακατεύθυνση στη σύνδεση.
  const requirePage = (...roles) => (req, res, next) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (roles.length && !roles.includes(req.user.role)) return res.redirect('/?denied=1');
    next();
  };

  // Μπλοκάρει αιτήματα αλλαγής από άλλους ιστότοπους (CSRF), επιπλέον του SameSite cookie.
  function sameOrigin(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* άκυρο origin */ }
      if (host !== req.get('host')) return res.status(403).json({ error: 'Μη επιτρεπτή προέλευση αιτήματος' });
    }
    next();
  }

  // ---------- Routes ----------
  const router = express.Router();

  router.post('/auth/login', (req, res) => {
    const { token, user } = login(req.body?.pin, req.ip);
    setCookie(req, res, token);
    res.json({ user });
  });

  router.post('/auth/logout', (req, res) => {
    if (req.user) q.deleteSession.run(req.user.sessionHash);
    clearCookie(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireRole(), (req, res) => {
    const { sessionHash, ...user } = req.user;
    res.json({ user, roles: ROLES });
  });

  router.get('/admin/users', requireRole('admin'), (req, res) => {
    res.json({ users: listUsers(), roles: ROLES, me: req.user.id });
  });

  router.post('/admin/users', requireRole('admin'), (req, res) => {
    res.status(201).json(createUser(req.body || {}));
  });

  router.patch('/admin/users/:id', requireRole('admin'), (req, res) => {
    res.json(updateUserTx(Number(req.params.id), req.body || {}));
  });

  return {
    router, attachUser, requireRole, requirePage, sameOrigin, userFromRequest,
    createUser, updateUser: updateUserTx, listUsers, ensureInitialAdmin, login,
  };
}

module.exports = { createAuth, AuthError, ROLES };
