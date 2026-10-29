// Αποστέλλει τα γεγονότα του outbox στο ERP. Τα γεγονότα γράφονται στη βάση μέσα στην ίδια
// συναλλαγή με την αλλαγή της παραγγελίας, οπότε δεν χάνονται αν το ERP είναι προσωρινά εκτός.

const crypto = require('crypto');

const MAX_ATTEMPTS = 12;

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function backoffMs(attempts) {
  return Math.min(5 * 60_000, 2_000 * 2 ** (attempts - 1));
}

function startWebhookDispatcher(db, { url, secret, intervalMs = 2_000, fetchImpl = fetch, log = console } = {}) {
  if (!url) {
    log.info('[webhook] ERP_WEBHOOK_URL κενό — δεν στέλνονται ενημερώσεις στο ERP');
    return { stop() {}, flush: async () => {} };
  }

  const due = db.prepare(`SELECT * FROM outbox WHERE delivered_at IS NULL AND attempts < ? AND next_attempt_at <= ?
                          ORDER BY id LIMIT 20`);
  const delivered = db.prepare('UPDATE outbox SET delivered_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?');
  const failed = db.prepare('UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?');

  let running = false;
  async function flush() {
    if (running) return;
    running = true;
    try {
      for (const row of due.all(MAX_ATTEMPTS, new Date().toISOString())) {
        try {
          const headers = { 'Content-Type': 'application/json', 'X-KDS-Event': row.event, 'X-KDS-Delivery': String(row.id) };
          if (secret) headers['X-KDS-Signature'] = sign(secret, row.payload);
          const res = await fetchImpl(url, {
            method: 'POST', headers, body: row.payload, signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          delivered.run(new Date().toISOString(), row.id);
        } catch (err) {
          const attempts = row.attempts + 1;
          failed.run(attempts, new Date(Date.now() + backoffMs(attempts)).toISOString(), String(err.message || err), row.id);
          log.warn(`[webhook] αποτυχία #${attempts} για γεγονός ${row.id}: ${err.message || err}`);
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(flush, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), flush };
}

module.exports = { startWebhookDispatcher, sign };
