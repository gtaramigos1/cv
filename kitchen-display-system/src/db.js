const fs = require('fs');
const path = require('path');
// Ενσωματωμένη SQLite του Node (χωρίς native εξαρτήσεις / μεταγλώττιση).
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id   TEXT NOT NULL UNIQUE,
  order_type    TEXT NOT NULL DEFAULT 'dine_in',
  table_label   TEXT,
  customer_name TEXT,
  waiter        TEXT,
  notes         TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal',
  status        TEXT NOT NULL DEFAULT 'new',
  erp_created_at TEXT,
  received_at   TEXT NOT NULL,
  ready_at      TEXT,
  completed_at  TEXT,
  cancelled_at  TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  qty           REAL NOT NULL DEFAULT 1,
  category      TEXT,
  station       TEXT NOT NULL,
  course        INTEGER NOT NULL DEFAULT 1,
  modifiers     TEXT NOT NULL DEFAULT '[]',
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  added_at      TEXT NOT NULL,
  done_at       TEXT,
  UNIQUE (order_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_items_station ON order_items(station, status);

CREATE TABLE IF NOT EXISTS outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event           TEXT NOT NULL,
  payload         TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  delivered_at    TEXT,
  last_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox(delivered_at, next_attempt_at);

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  pin_key     TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_received ON orders(received_at);
`;

// Στήλες που προστέθηκαν σε επόμενες εκδόσεις (για βάσεις που υπάρχουν ήδη).
const MIGRATIONS = [
  { table: 'order_items', column: 'unit_price', sql: 'ALTER TABLE order_items ADD COLUMN unit_price REAL' },
];

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all().map((c) => c.name);
    if (!cols.includes(m.column)) db.exec(m.sql);
  }

  // Τα statements δέχονται αντικείμενα με επιπλέον πεδία (π.χ. όλο το payload της παραγγελίας).
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = prepare(sql);
    stmt.setAllowUnknownNamedParameters(true);
    return stmt;
  };

  // db.transaction(fn) → συνάρτηση που τρέχει το fn σε συναλλαγή (rollback σε σφάλμα).
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return db;
}

module.exports = { openDb };
