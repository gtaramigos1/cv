import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { renameMenu, addItemToMenu, removeItemFromMenu } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditMenuPage({ params }: { params: { id: string } }) {
  const menu = await prisma.menu.findUnique({
    where: { id: params.id },
    include: { items: { select: { menuItemId: true } } },
  });

  if (!menu) notFound();

  const allItems = await prisma.menuItem.findMany({
    include: { category: true },
    orderBy: [{ category: { order: "asc" } }, { name: "asc" }],
  });

  const includedIds = new Set(menu.items.map((i) => i.menuItemId));

  const grouped = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const key = item.category?.name ?? "Χωρίς κατηγορία";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-2xl font-semibold">{menu.name}</h1>
        {menu.isActive && (
          <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-semibold text-gold">
            Ενεργό στο site
          </span>
        )}
      </div>

      <form
        action={renameMenu.bind(null, menu.id)}
        className="mb-8 flex gap-3 rounded-lg border border-ink/10 bg-white p-4"
      >
        <input
          name="name"
          defaultValue={menu.name}
          required
          className="flex-1 rounded-md border border-ink/20 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-ink/90"
        >
          Μετονομασία
        </button>
      </form>

      <p className="mb-4 text-sm text-ink/60">
        Επίλεξε ποια είδη περιλαμβάνονται σε αυτό το μενού.
      </p>

      {allItems.length === 0 ? (
        <p className="text-ink/50">
          Δεν έχεις προσθέσει ακόμα είδη. Πήγαινε στη σελίδα «Είδη» για να προσθέσεις.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">
                {category}
              </h2>
              <div className="space-y-2">
                {items.map((item) => {
                  const included = includedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-lg border border-ink/10 bg-white p-3"
                    >
                      <div>
                        <p className="font-medium">{item.name}</p>
                        {item.description && (
                          <p className="text-sm text-ink/50">{item.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-ink/70">
                          {Number(item.price).toFixed(2)} €
                        </span>
                        <form
                          action={
                            included
                              ? removeItemFromMenu.bind(null, menu.id, item.id)
                              : addItemToMenu.bind(null, menu.id, item.id)
                          }
                        >
                          <button
                            type="submit"
                            className={
                              included
                                ? "rounded-md border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
                                : "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
                            }
                          >
                            {included ? "Αφαίρεση" : "Προσθήκη"}
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
