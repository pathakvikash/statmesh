"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";

/** Shared layout for 404/error states. Not a landmark (the root layout owns <main>); the heading takes focus on mount. */
export function StateShell({ title, children }: { title: string; children: React.ReactNode }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus(), []);
  return (
    <div className="mx-auto max-w-xl space-y-4 py-10">
      <h1 ref={h} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{title}</h1>
      {children}
    </div>
  );
}

const link = "rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted";

/** 404 content: a cause sentence, a GET search form to /search and links to the main sections. */
export function NotFoundState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <StateShell title={title}>
      <p className="text-muted-foreground">{children}</p>
      <form action="/search" method="get" role="search" className="flex gap-2">
        <input type="search" name="q" aria-label="Search statistics" placeholder="Search statistics" required
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm" />
        <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground">Search</button>
      </form>
      <nav aria-label="Where to go next" className="flex flex-wrap gap-2">
        <Link className={link} href="/search">Search</Link><Link className={link} href="/sources">Sources</Link><Link className={link} href="/sql">SQL</Link>
      </nav>
    </StateShell>
  );
}
