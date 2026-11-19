import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "statmesh", description: "Browse official statistics with citations" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">
        <header className="border-b border-slate-300">
          <nav aria-label="Main" className="mx-auto flex max-w-5xl gap-6 px-4 py-3">
            <Link href="/" className="font-bold">statmesh</Link>
            <Link href="/" className="underline">Search</Link>
            <Link href="/sql" className="underline">SQL</Link>
            <Link href="/sources" className="underline">Sources</Link>
            <Link href="/chat" className="underline">Chat</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
