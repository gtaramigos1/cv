import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createMenu, deleteMenu, activateMenu, deactivateMenu } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminMenusPage() {
  const menus = await prisma.menu.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl font-semibold">Μενού</h1>

      <section className="mb-10 rounded-lg border border-ink/10 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Νέο μενού
        </h2>
        <form action={createMenu} className="flex gap-3">
          <input
            name="name"
            placeholder="π.χ. Καθημερινό Μενού, Σαββατοκύριακο..."
            required
            className="flex-1 rounded-md border border-ink/20 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent/90"
          >
            Δημιουργία
          </button>
        </form>
      </section>

      <section className="space-y-3">
        {menus.length === 0 ? (
          <p className="text-ink/50">Δεν υπάρχουν ακόμα μενού.</p>
        ) : (
          menus.map((menu) => (
            <div
              key={menu.id}
              className="flex items-center justify-between rounded-lg border border-ink/10 bg-white p-4"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/admin/menus/${menu.id}`} className="font-medium hover:text-accent">
                    {menu.name}
                  </Link>
                  {menu.isActive && (
                    <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-semibold text-gold">
                      Ενεργό
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink/50">{menu._count.items} είδη</p>
              </div>
              <div className="flex gap-2">
                {menu.isActive ? (
                  <form action={deactivateMenu.bind(null, menu.id)}>
                    <button
                      type="submit"
                      className="rounded-md border border-ink/20 px-3 py-1.5 text-sm hover:bg-ink/5"
                    >
                      Απενεργοποίηση
                    </button>
                  </form>
                ) : (
                  <form action={activateMenu.bind(null, menu.id)}>
                    <button
                      type="submit"
                      className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-cream hover:bg-ink/90"
                    >
                      Ενεργοποίηση
                    </button>
                  </form>
                )}
                <Link
                  href={`/admin/menus/${menu.id}`}
                  className="rounded-md border border-ink/20 px-3 py-1.5 text-sm hover:bg-ink/5"
                >
                  Επεξεργασία
                </Link>
                <form action={deleteMenu.bind(null, menu.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
                  >
                    Διαγραφή
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
