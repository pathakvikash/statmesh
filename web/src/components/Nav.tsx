"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAssistant } from "./ai/AssistantProvider";
import { CommandPalette } from "./CommandPalette";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/search", label: "Search" },
  { href: "/sources", label: "Sources" },
  { href: "/sql", label: "SQL" },
  { href: "/chat", label: "Chat" },
];

export function Nav() {
  const path = usePathname();
  const assistant = useAssistant();
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
  const active = (href: string) => (href === "/search" ? path.startsWith("/search") || path.startsWith("/series") : path.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-1 px-4 sm:h-14 sm:flex-nowrap sm:px-6">
        <Link href="/" className="mr-3 flex min-h-11 items-center font-semibold tracking-tight">
          <Logo />
        </Link>
        <div className="order-3 flex w-full gap-1 border-t border-border/60 sm:order-none sm:w-auto sm:border-0">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm transition-colors hover:bg-muted sm:min-h-0 sm:flex-none sm:py-1.5 ${active(l.href) ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {l.label}
          </Link>
        ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open command palette"
            className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 sm:min-h-0 sm:min-w-0 sm:py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted">
            <svg aria-hidden viewBox="0 0 24 24" className="size-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <span className="hidden sm:inline">Search…</span>
            <kbd className="hidden rounded border border-border px-1.5 font-mono text-xs sm:inline">⌘K</kbd>
          </button>
          <button type="button" id="assistant-toggle" onClick={assistant.toggle} aria-label="Toggle AI assistant" aria-expanded={assistant.open}
            aria-controls="assistant-panel" title="AI assistant (Ctrl/⌘ J)"
            className="grid size-11 place-items-center sm:size-9 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z" /></svg>
          </button>
          <ThemeToggle />
        </div>
      </nav>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </header>
  );
}
