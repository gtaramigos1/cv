import { prisma } from "@/lib/prisma";
import { createItem, updateItem, deleteItem } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminItemsPage() {
  const [items, categories] = await Promise.all([
    prisma.menuItem.findMany({
      include: { category: true },
      orderBy: [{ category: { order: "asc" } }, { name: "asc" }],
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl font-semibold">Είδη Μενού</h1>

      <section className="mb-10 rounded-lg border border-ink/10 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Νέο είδος
        </h2>
        <form action={createItem} className="grid gap-3 sm:grid-cols-2">
          <input
            name="name"
            placeholder="Όνομα (π.χ. Μουσακάς)"
            required
            className="rounded-md border border-ink/20 px-3 py-2 sm:col-span-2"
          />
          <input
            name="description"
            placeholder="Περιγραφή (προαιρετικό)"
            className="rounded-md border border-ink/20 px-3 py-2 sm:col-span-2"
          />
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            placeholder="Τιμή (€)"
            required
            className="rounded-md border border-ink/20 px-3 py-2"
          />
          <input
            name="category"
            list="category-options"
            placeholder="Κατηγορία (π.χ. Ορεκτικά)"
            className="rounded-md border border-ink/20 px-3 py-2"
          />
          <datalist id="category-options">
            {categories.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent/90 sm:col-span-2"
          >
            Προσθήκη είδους
          </button>
        </form>
      </section>

      <section className="space-y-3">
        {items.length === 0 ? (
          <p className="text-ink/50">Δεν υπάρχουν ακόμα είδη.</p>
        ) : (
          items.map((item) => (
            <form
              key={item.id}
              action={updateItem.bind(null, item.id)}
              className="grid gap-3 rounded-lg border border-ink/10 bg-white p-4 sm:grid-cols-[1fr_1fr_120px_140px_auto] sm:items-center"
            >
              <input
                name="name"
                defaultValue={item.name}
                required
                className="rounded-md border border-ink/20 px-3 py-2"
              />
              <input
                name="description"
                defaultValue={item.description ?? ""}
                placeholder="Περιγραφή"
                className="rounded-md border border-ink/20 px-3 py-2"
              />
              <input
                name="price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={item.price.toString()}
                required
                className="rounded-md border border-ink/20 px-3 py-2"
              />
              <input
                name="category"
                list="category-options"
                defaultValue={item.category?.name ?? ""}
                placeholder="Κατηγορία"
                className="rounded-md border border-ink/20 px-3 py-2"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 rounded-md bg-ink px-3 py-2 text-sm font-medium text-cream hover:bg-ink/90"
                >
                  Αποθήκευση
                </button>
                <button
                  type="submit"
                  formAction={deleteItem.bind(null, item.id)}
                  className="rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10"
                >
                  Διαγραφή
                </button>
              </div>
            </form>
          ))
        )}
      </section>
    </div>
  );
}
