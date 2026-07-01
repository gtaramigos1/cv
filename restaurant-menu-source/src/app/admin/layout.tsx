import Link from "next/link";
import { logout } from "./login/actions";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/admin/items" className="hover:text-accent">
              Είδη
            </Link>
            <Link href="/admin/menus" className="hover:text-accent">
              Μενού
            </Link>
            <Link href="/" className="hover:text-accent" target="_blank">
              Προβολή site ↗
            </Link>
          </nav>
          <form action={logout}>
            <button type="submit" className="text-sm text-ink/50 hover:text-accent">
              Αποσύνδεση
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
