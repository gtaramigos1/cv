# Kitchen Display System (KDS)

Οθόνες κουζίνας σε πραγματικό χρόνο. Οι παραγγελίες έρχονται από **οποιοδήποτε ERP/POS** μέσω REST API, και οι αλλαγές κατάστασης γυρνούν πίσω στο ERP μέσω webhook.

```
 ERP / POS ──POST /api/erp/orders──▶  KDS server  ──WebSocket──▶  Οθόνες (tablet/TV)
     ▲                                (Node + SQLite)                Ψησταριά · Κουζίνα · Μπαρ · Expo
     └──────── webhook: order.status_changed ◀──┘
```

## Δυνατότητες

- **Stations**: κάθε είδος πηγαίνει αυτόματα στο σωστό πόστο (ψησταριά, κουζίνα, κρύα, μπαρ) με βάση την κατηγορία του (`config/stations.json`).
- **Expo / Πάσο**: βλέπει όλη την παραγγελία, τι έχει γίνει σε κάθε πόστο, και την κλείνει όταν σερβιριστεί.
- **Χρονόμετρα**: οι κάρτες γίνονται κίτρινες και μετά κόκκινες, με όρια ανά station.
- **Bump & recall**: «Έτοιμο» με ένα πάτημα (ή τα πλήκτρα 1–9 από bump bar), και επαναφορά αν πατήθηκε κατά λάθος.
- **Αλλαγές από το ERP**: αν ξανασταλεί η ίδια παραγγελία, τα νέα είδη επισημαίνονται «ΝΕΟ», τα αφαιρεμένα φαίνονται «ΑΚΥΡΟ», και όσα άλλαξαν ποσότητα ξαναμπαίνουν σε αναμονή.
- Επείγουσες παραγγελίες (rush) μπαίνουν πρώτες, με σημειώσεις/αλλεργίες, modifiers, πιάτα (courses) και σύνολα ειδών (all-day).
- Ηχητική ειδοποίηση για νέα παραγγελία, πλήρης οθόνη, αυτόματη επανασύνδεση.
- Αξιόπιστο webhook: τα γεγονότα αποθηκεύονται (outbox) και ξαναστέλνονται με backoff αν το ERP είναι εκτός.
- Τρέχει τοπικά στο κατάστημα και δεν χρειάζεται internet.

## Εκκίνηση

Απαιτείται **Node.js 22.13 ή νεότερο**. Η βάση είναι η ενσωματωμένη SQLite του Node, άρα δεν χρειάζεται Visual Studio ούτε άλλα εργαλεία μεταγλώττισης.

```bash
cd kitchen-display-system
npm install
```

```bash
ERP_API_KEY=change-me npm start
```

Στα Windows (cmd) η εκκίνηση γίνεται με `set ERP_API_KEY=change-me && npm start`.

Άνοιξε `http://<ip-server>:3000` σε κάθε οθόνη και διάλεξε station, ή πήγαινε κατευθείαν σε `/?station=grill` ή `/?station=expo`.

Για δοκιμή χωρίς ERP στέλνει 10 τυχαίες παραγγελίες, μία κάθε 3":

```bash
ERP_API_KEY=change-me npm run simulate -- 10 3
```

Tests:

```bash
npm test
```

Ρυθμίσεις μέσω μεταβλητών περιβάλλοντος: δες το `.env.example`.

## Λήψη παραγγελιών (POS σερβιτόρων)

Άνοιξε **`http://<ip-server>:3000/pos`** σε κινητό, tablet ή υπολογιστή.

1. Γράψε το όνομα του σερβιτόρου πάνω δεξιά. Το αποθηκεύει η συσκευή.
2. Διάλεξε **Τραπέζι / Πακέτο / Delivery** και συμπλήρωσε τραπέζι ή όνομα πελάτη.
3. Πάτα είδη από το μενού. Πατώντας μια γραμμή του καλαθιού αλλάζεις ποσότητα, επιλογές (π.χ. «Χωρίς κρεμμύδι»), σημείωση και πότε σερβίρεται (μαζί / μετά / στο τέλος).
4. **Αποστολή στην κουζίνα**: τα είδη πάνε αμέσως στις σωστές οθόνες.
5. Στην καρτέλα **Παραγγελίες** βλέπεις την κατάσταση κάθε παραγγελίας. Όταν γίνει έτοιμη, εμφανίζεται ειδοποίηση με ήχο. Από εκεί γίνεται και η ακύρωση.

Οι παραγγελίες του POS παίρνουν αριθμούς `P-1`, `P-2`, … και, αν έχει οριστεί webhook, ενημερώνουν το ERP όπως όλες οι άλλες.

### Μενού

Το μενού βρίσκεται στο `config/menu.json`. Οι αλλαγές ισχύουν με ανανέωση της σελίδας, χωρίς επανεκκίνηση του server.

```json
{ "id": "burgers", "name": "Burgers", "items": [
  { "id": "burger-classic", "name": "Burger Classic", "price": 10, "modifiers": ["Χωρίς κρεμμύδι", "Extra τυρί"] }
]}
```

- Το `id` της κατηγορίας καθορίζει σε ποιο πόστο πάει το είδος (δες `categoryRouting` στο `config/stations.json`). Για συγκεκριμένο είδος μπορείς να βάλεις `"station": "bar"`.
- Τα `id` των ειδών πρέπει να είναι μοναδικά.

## Σύνδεση με ERP

### 1. ERP → KDS: αποστολή παραγγελίας

`POST /api/erp/orders` με header `Authorization: Bearer <ERP_API_KEY>` (ή `X-API-Key`).

```json
{
  "external_id": "INV-1001",
  "order_type": "dine_in",
  "table": "12",
  "waiter": "Μαρία",
  "customer_name": null,
  "priority": "normal",
  "notes": "ΑΛΛΕΡΓΙΑ: ξηροί καρποί",
  "created_at": "2026-10-29T12:30:00Z",
  "items": [
    { "line_id": "1", "name": "Burger Classic", "qty": 2, "category": "burgers",
      "modifiers": ["Χωρίς κρεμμύδι"], "notes": "medium", "course": 1 },
    { "line_id": "2", "name": "Freddo Espresso", "qty": 1, "station": "bar" }
  ]
}
```

| Πεδίο | Υποχρεωτικό | Σημείωση |
|---|---|---|
| `external_id` | ναι | Ο αριθμός παραστατικού/παραγγελίας στο ERP. Μοναδικός. |
| `order_type` | | `dine_in` (προεπιλογή), `takeaway`, `delivery` |
| `priority` | | `normal` ή `rush` |
| `items[].name` | ναι | |
| `items[].line_id` | συνιστάται | Σταθερό id γραμμής. Χρειάζεται για σωστές ενημερώσεις. |
| `items[].qty` | | Προεπιλογή 1 |
| `items[].station` | | Ορίζει το station ρητά. Αλλιώς δρομολογείται από το `category`, και αν δεν ταιριάζει, πάει στο `defaultStation`. |
| `items[].course` | | Ομαδοποίηση ανά πιάτο (1, 2, …) |

- **201** σημαίνει νέα παραγγελία. **200** σημαίνει ότι η παραγγελία υπήρχε και ενημερώθηκε. Μπορείς να ξαναστείλεις με ασφάλεια το ίδιο `external_id` (idempotent).
- Σε ενημέρωση, το ERP στέλνει **όλη** την παραγγελία. Οι γραμμές που λείπουν θεωρούνται αφαιρεμένες.
- **409** σημαίνει ότι η παραγγελία έχει ήδη ολοκληρωθεί ή ακυρωθεί. **400** σημαίνει λάθος δεδομένα (το μήνυμα εξηγεί τι λείπει).

Άλλα endpoints:

- `POST /api/erp/orders/:external_id/cancel`: ακύρωση
- `GET /api/erp/orders/:external_id`: τρέχουσα κατάσταση

### 2. KDS → ERP: ενημερώσεις κατάστασης (webhook)

Αν οριστεί `ERP_WEBHOOK_URL`, το KDS στέλνει `POST` σε κάθε αλλαγή:

```json
{
  "event": "order.status_changed",
  "occurred_at": "2026-10-29T12:41:07Z",
  "order": {
    "external_id": "INV-1001",
    "status": "ready",
    "ready_at": "2026-10-29T12:41:07Z",
    "completed_at": null,
    "cancelled_at": null,
    "items": [{ "line_id": "1", "name": "Burger Classic", "qty": 2, "station": "grill", "status": "done", "done_at": "..." }]
  }
}
```

- Γεγονότα: `order.received` και `order.status_changed`.
- Καταστάσεις: `new` → `in_progress` → `ready` → `completed`, ή `cancelled`.
- Headers: `X-KDS-Event`, `X-KDS-Delivery` (μοναδικό id, για αποφυγή διπλοεγγραφών), και `X-KDS-Signature: sha256=<HMAC του body με ERP_WEBHOOK_SECRET>`.
- Αν δεν απαντήσει 2xx, το KDS ξαναπροσπαθεί έως 12 φορές με αυξανόμενη αναμονή (έως 5').

### Πώς το συνδέεις με το δικό σου ERP

Τα περισσότερα ERP (SoftOne, Entersoft, Epsilon, Odoo κ.ά.) καλύπτονται με έναν από δύο τρόπους:

1. **Push**: ένα script/trigger στο ERP, κατά την καταχώρηση παραγγελίας, κάνει `POST` στο `/api/erp/orders`.
2. **Middleware**: ένα μικρό script κάνει polling στο web service του ERP για νέα παραστατικά και τα προωθεί στο KDS με την ίδια μορφή.

Για την επιστροφή, το ERP (ή το middleware) δέχεται το webhook και ενημερώνει το παραστατικό, π.χ. «Έτοιμο για σερβίρισμα».

## Δομή

```
config/stations.json   stations, όρια χρόνου, δρομολόγηση κατηγοριών
src/server.js          HTTP API + WebSocket
src/orders.js          λογική παραγγελιών (δρομολόγηση, bump, recall, ενημερώσεις)
src/erpWebhook.js      αποστολή γεγονότων στο ERP (outbox με retry)
src/pos.js             λήψη παραγγελιών από το κατάστημα (/pos)
config/menu.json       μενού για το POS
src/db.js              σχήμα SQLite
public/                η οθόνη κουζίνας (HTML/CSS/JS, χωρίς build)
scripts/simulate.js    προσομοίωση ERP
test/                  tests (node --test)
```

## Παραγωγή

- Βάλε ισχυρό `ERP_API_KEY`. Το API των οθονών δεν έχει login, γι' αυτό ο server πρέπει να είναι προσβάσιμος μόνο από το τοπικό δίκτυο του καταστήματος.
- Τρέξε τον server ως υπηρεσία (systemd, pm2 ή Windows Service) ώστε να ξεκινά αυτόματα.
- Οι οθόνες μπορούν να είναι οποιοδήποτε tablet ή TV με browser. Σε Android, ο Chrome σε kiosk mode δουλεύει καλά.
