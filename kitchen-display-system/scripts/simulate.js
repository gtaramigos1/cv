// Προσομοιώνει ένα ERP που στέλνει παραγγελίες στο KDS.
// Χρήση: node scripts/simulate.js [πλήθος] [διάστημα_σε_δευτερόλεπτα]
const BASE = (process.env.KDS_URL || 'http://localhost:3000').trim();
// trim: στο cmd των Windows το `set X=y && ...` αφήνει κενό στο τέλος της τιμής.
const KEY = (process.env.ERP_API_KEY || '').trim();
const count = Number(process.argv[2] || 5);
const intervalSec = Number(process.argv[3] || 4);

const MENU = [
  { name: 'Burger Classic', category: 'burgers', modifiers: [['Χωρίς κρεμμύδι'], ['Extra τυρί'], []] },
  { name: 'Σουβλάκι χοιρινό', category: 'souvlaki', modifiers: [['Χωρίς τζατζίκι'], []] },
  { name: 'Μουσακάς', category: 'mains', modifiers: [[]] },
  { name: 'Καρμπονάρα', category: 'pasta', modifiers: [['Χωρίς μπέικον'], []] },
  { name: 'Χωριάτικη', category: 'salads', modifiers: [['Χωρίς ελιές'], []] },
  { name: 'Τζατζίκι', category: 'appetizers', modifiers: [[]] },
  { name: 'Freddo Espresso', category: 'coffee', modifiers: [['Μέτριος'], ['Σκέτος']] },
  { name: 'Πορτοκαλάδα', category: 'drinks', modifiers: [[]] },
  { name: 'Σοκολατόπιτα', category: 'desserts', modifiers: [[]] },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function randomOrder(n) {
  const type = pick(['dine_in', 'dine_in', 'dine_in', 'takeaway', 'delivery']);
  const items = Array.from({ length: 1 + Math.floor(Math.random() * 4) }, (_, i) => {
    const m = pick(MENU);
    return {
      line_id: String(i + 1),
      name: m.name,
      qty: 1 + Math.floor(Math.random() * 2),
      category: m.category,
      modifiers: pick(m.modifiers),
      notes: Math.random() < 0.15 ? 'Καλοψημένο' : undefined,
      course: m.category === 'desserts' ? 2 : 1,
    };
  });
  return {
    external_id: `SIM-${Date.now().toString().slice(-6)}-${n}`,
    order_type: type,
    table: type === 'dine_in' ? String(1 + Math.floor(Math.random() * 20)) : undefined,
    customer_name: type !== 'dine_in' ? pick(['Γιώργος', 'Μαρία', 'Νίκος', 'Ελένη']) : undefined,
    waiter: pick(['Κώστας', 'Άννα', 'Δημήτρης']),
    priority: Math.random() < 0.1 ? 'rush' : 'normal',
    notes: Math.random() < 0.1 ? 'ΑΛΛΕΡΓΙΑ: ξηροί καρποί' : undefined,
    created_at: new Date().toISOString(),
    items,
  };
}

async function send(order) {
  const res = await fetch(`${BASE}/api/erp/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(order),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${body.error}`);
  console.log(`→ #${order.external_id}: ${order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}`);
}

(async () => {
  for (let n = 1; n <= count; n++) {
    await send(randomOrder(n)).catch((e) => console.error('Σφάλμα:', e.message));
    if (n < count) await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
})();
