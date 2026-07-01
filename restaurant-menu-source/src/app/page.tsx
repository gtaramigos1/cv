import { prisma } from "@/lib/prisma";

export const revalidate = 0;

export default async function HomePage() {
  const activeMenu = await prisma.menu.findFirst({
    where: { isActive: true },
    include: {
      items: {
        orderBy: { order: "asc" },
        include: { menuItem: { include: { category: true } } },
      },
    },
  });

  const today = new Intl.DateTimeFormat("el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const grouped = new Map<
    string,
    { name: string; description: string | null; price: number }[]
  >();

  if (activeMenu) {
    for (const { menuItem } of activeMenu.items) {
      const key = menuItem.category?.name ?? "Λοιπά";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({
        name: menuItem.name,
        description: menuItem.description,
        price: Number(menuItem.price),
      });
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-12">
      <header className="mb-10 text-center">
        <h1 className="font-serif text-4xl font-bold tracking-tight text-ink">
          {activeMenu?.name ?? "Μενού"}
        </h1>
        <p className="mt-2 text-sm capitalize text-ink/50">{today}</p>
      </header>

      {!activeMenu || grouped.size === 0 ? (
        <p className="text-center text-ink/50">
          Το μενού της ημέρας δεν έχει δημοσιευτεί ακόμα. Ξαναδές μας σύντομα!
        </p>
      ) : (
        <div className="space-y-10">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-4 border-b-2 border-gold/50 pb-1 text-lg font-semibold uppercase tracking-widest text-accent">
                {category}
              </h2>
              <ul className="space-y-4">
                {items.map((item) => (
                  <li key={item.name} className="flex items-baseline justify-between gap-4">
                    <div>
                      <p className="font-medium text-ink">{item.name}</p>
                      {item.description && (
                        <p className="text-sm text-ink/50">{item.description}</p>
                      )}
                    </div>
                    <span className="whitespace-nowrap font-semibold text-ink">
                      {item.price.toFixed(2)} €
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <footer className="mt-16 text-center text-xs text-ink/30">
        <a href="/admin" className="hover:text-ink/60">
          διαχείριση
        </a>
      </footer>
    </main>
  );
}
