"use client";
import { useState } from "react";
import { TEMPLATES } from "@/lib/sql-templates";
import type { SavedQuery } from "@/lib/sql-store";

type Tab = "Templates" | "Saved" | "Recent";
const use = "shrink-0 rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted";

export function Drawer({ saved, recent, onUse, onDelete }: {
  saved: SavedQuery[]; recent: string[]; onUse: (sql: string) => void; onDelete: (i: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("Templates");
  const empty = (s: string) => <li className="p-2 text-sm text-muted-foreground">{s}</li>;
  return (
    <section aria-label="Templates, saved and recent queries" className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
      <div role="tablist" className="flex border-b border-border text-sm">
        {(["Templates", "Saved", "Recent"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 px-2 py-2 font-medium ${tab === t ? "border-b-2 border-accent" : "text-muted-foreground hover:bg-muted"}`}>{t}</button>
        ))}
      </div>
      <ul role="tabpanel" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {tab === "Templates" && TEMPLATES.map((t) => (
          <li key={t.id} className="rounded-lg border border-border p-2">
            <p className="text-sm font-semibold">{t.title}</p>
            <p className="mb-1 text-xs text-muted-foreground">{t.description}</p>
            <button onClick={() => onUse(t.sql)} className={use}>Use</button>
          </li>
        ))}
        {tab === "Saved" && (saved.length ? saved.map((s, i) => (
          <li key={i} className="rounded-lg border border-border p-2">
            <p className="text-sm font-semibold">{s.name}</p>
            <p className="mb-1 truncate font-mono text-xs text-muted-foreground">{s.sql}</p>
            <button onClick={() => onUse(s.sql)} className={use}>Use</button>{" "}
            <button onClick={() => onDelete(i)} className={use}>Delete</button>
          </li>
        )) : empty("Nothing saved yet. Write a query and press Save."))}
        {tab === "Recent" && (recent.length ? recent.map((s, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
            <p className="min-w-0 flex-1 truncate font-mono text-xs">{s.replace(/\s+/g, " ")}</p>
            <button onClick={() => onUse(s)} className={use}>Use</button>
          </li>
        )) : empty("Queries you run appear here (last 20)."))}
      </ul>
    </section>
  );
}
