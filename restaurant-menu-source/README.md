# Μενού Εστιατορίου

Mini site για το ημερήσιο μενού του εστιατορίου, με σελίδα διαχείρισης (`/admin`) όπου
μπορείς να δημιουργείς είδη με τιμές, να τα οργανώνεις σε μενού, και να επιλέγεις ποιο
μενού είναι "ενεργό" και εμφανίζεται στους πελάτες.

- Δημόσια σελίδα (`/`): δείχνει το τρέχον ενεργό μενού, ομαδοποιημένο ανά κατηγορία.
- Διαχείριση (`/admin`, προστατευμένο με κωδικό): CRUD για είδη, δημιουργία πολλών
  μενού, επιλογή ποιο είναι ενεργό.

Χτισμένο με Next.js (App Router) + Prisma + Postgres, έτοιμο για hosting στο Vercel.

## 1. Δημιουργία βάσης δεδομένων (Vercel Postgres / Neon)

1. Πήγαινε στο [Vercel Dashboard](https://vercel.com/dashboard) → το project σου (ή
   δημιούργησέ το πρώτα importάροντας αυτό το repo) → tab **Storage**.
2. Πάτα **Create Database** → επίλεξε **Postgres** (powered by Neon) → **Connect** στο
   project σου.
3. Το Vercel προσθέτει αυτόματα τα environment variables `POSTGRES_PRISMA_URL` και
   `POSTGRES_URL_NON_POOLING` στο project (Production, Preview, Development).

## 2. Environment variables

Στο **Project Settings → Environment Variables** πρόσθεσε επιπλέον:

| Variable | Τιμή |
| --- | --- |
| `ADMIN_PASSWORD` | Ο κωδικός που θα χρησιμοποιείς για να μπαίνεις στο `/admin` |
| `SESSION_SECRET` | Τυχαίο secret για την υπογραφή του session cookie. Δημιούργησέ το με `openssl rand -base64 32` |

Για τοπική ανάπτυξη, αντίγραψε το `.env.example` σε `.env` και συμπλήρωσε τις τιμές
(τα `POSTGRES_*` URLs τα βρίσκεις στο Vercel Storage tab → `.env.local` tab, ή βάλε
οποιαδήποτε τοπική Postgres σου).

## 3. Δημιουργία πινάκων στη βάση

Αφού έχεις ορίσει τα `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` (τοπικά στο
`.env`, ή τραβώντας τα με `vercel env pull`), τρέξε:

```bash
npm install
npx prisma db push
```

Αυτό δημιουργεί τους πίνακες `Category`, `MenuItem`, `Menu`, `MenuItemOnMenu` στη βάση.

## 4. Τοπική ανάπτυξη

```bash
npm install
npm run dev
```

Άνοιξε [http://localhost:3000](http://localhost:3000) για το δημόσιο μενού και
[http://localhost:3000/admin](http://localhost:3000/admin) για τη διαχείριση.

## 5. Deploy στο Vercel

1. Import το repo στο Vercel (New Project → επίλεξε αυτό το repo).
2. Βεβαιώσου ότι έχεις κάνει τα βήματα 1-3 παραπάνω (database + env vars + `db push`).
3. Deploy. Το `npm run build` τρέχει αυτόματα `prisma generate` πριν το `next build`.

## Πώς λειτουργεί η καθημερινή ενημέρωση

1. Στο `/admin/items` προσθέτεις όλα τα πιάτα/ποτά που σερβίρεις, με τιμή και
   κατηγορία (π.χ. Ορεκτικά, Κυρίως, Επιδόρπια).
2. Στο `/admin/menus` δημιουργείς όσα "μενού" θέλεις (π.χ. "Καθημερινό",
   "Σαββατοκύριακο", "Πασχαλινό") και επιλέγεις ποια είδη περιλαμβάνει το καθένα.
3. Πατώντας **Ενεργοποίηση** σε ένα μενού, αυτό γίνεται το μοναδικό που εμφανίζεται
   στην αρχική σελίδα — έτσι αλλάζεις τι βλέπουν οι πελάτες χωρίς να διαγράφεις τίποτα.
