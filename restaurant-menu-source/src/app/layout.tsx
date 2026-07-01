import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Μενού Εστιατορίου",
  description: "Το ημερήσιο μενού μας με τιμές",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el">
      <body className="font-serif text-ink antialiased">{children}</body>
    </html>
  );
}
