"use client";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { seriesHref } from "@/lib/format";

type Hit = { id: string; title: string; meta: string };
const PAGES = [
  { label: "Search data", href: "/" },
  { label: "Sources", href: "/sources" },
  { label: "SQL console", href: "/sql" },
  { label: "Chat with the AI", href: "/chat" },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch(`/api/palette?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        setHits(r.ok ? await r.json() : []);
      } catch { /* aborted or offline */ }
      setBusy(false);
    }, 200);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q]);

  const go = (href: string) => { onOpenChange(false); setQ(""); setHits([]); router.push(href); };
  const term = q.trim().toLowerCase();
  const pages = PAGES.filter((p) => !term || p.label.toLowerCase().includes(term));
  const shown = term.length < 2 ? [] : hits;

  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Command palette" shouldFilter={false}
      overlayClassName="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[15vh] z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      <Command.Input value={q} onValueChange={setQ} placeholder="Search series or jump to a page…"
        className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground" />
      <Command.List className="max-h-80 overflow-y-auto p-2 text-sm">
        {/* cmdk's <Command.Empty> never fires with shouldFilter={false} (the static items always count), so render our own. */}
        {!busy && shown.length === 0 && (term.length >= 2 || (term && !pages.length)) && <p role="status" className="px-3 py-4 text-center text-muted-foreground">{term.length >= 2 ? "No series found." : "No matches."}</p>}
        {shown.length > 0 && (
          <Command.Group heading="Series" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {shown.map((h) => (
              <Command.Item key={h.id} value={h.id} onSelect={() => go(seriesHref(h.id))}
                className="cursor-pointer rounded-lg px-3 py-2 data-[selected=true]:bg-muted">
                <div className="truncate font-medium">{h.title}</div>
                <div className="truncate text-xs text-muted-foreground">{h.meta}</div>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {term && (
          <Command.Item value={`ask-${term}`} onSelect={() => go(`/?q=${encodeURIComponent(q.trim())}`)}
            className="cursor-pointer rounded-lg px-3 py-2 data-[selected=true]:bg-muted">
            Search all results for &ldquo;{q.trim()}&rdquo;
          </Command.Item>
        )}
        {pages.length > 0 && (
          <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {pages.map((p) => (
              <Command.Item key={p.href} value={p.href} onSelect={() => go(p.href)}
                className="cursor-pointer rounded-lg px-3 py-2 data-[selected=true]:bg-muted">{p.label}</Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
