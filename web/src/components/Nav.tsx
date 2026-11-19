"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Search" },
  { href: "/sources", label: "Sources" },
  { href: "/sql", label: "SQL" },
  { href: "/chat", label: "Chat" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/series") : path.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-[1200px] items-center gap-1 px-4 sm:px-6">
        <Link href="/" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-accent text-xs text-accent-foreground">s</span>
          statmesh
        </Link>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-muted ${active(l.href) ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {l.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open command palette"
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted">
            <span className="hidden sm:inline">Search…</span>
            <kbd className="rounded border border-border px-1.5 font-mono text-xs">⌘K</kbd>
          </button>
          <ThemeToggle />
        </div>
      </nav>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </header>
  );
}
