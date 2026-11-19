"use client";
import { useState } from "react";
import type { SqlSchema } from "@/lib/sql-schema";

/** Every view, expandable, with columns, types and descriptions. Click to insert; Preview runs 10 rows. */
export function SchemaBrowser({ schema, live, insert, preview }: {
  schema: SqlSchema; live: boolean; insert: (s: string) => void; preview: (view: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["observations"]));
  const f = q.trim().toLowerCase();
  const views = schema.views
    .map((v) => ({ v, cols: f ? v.columns.filter((c) => (c.name + " " + c.description).toLowerCase().includes(f)) : v.columns }))
    .filter(({ v, cols }) => !f || cols.length || (v.name + " " + v.description).toLowerCase().includes(f));
  const toggle = (n: string) => setOpen((s) => { const x = new Set(s); if (!x.delete(n)) x.add(n); return x; });

  return (
    <section aria-label="Schema browser" className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border p-2">
        <h2 className="mb-1 text-sm font-semibold">Tables and columns</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Filter views and columns" aria-label="Filter views and columns"
          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm" />
        {!live && <p className="mt-1 text-xs text-muted-foreground">Showing the bundled schema; the API has no /schema route yet.</p>}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1 text-sm">
        {views.map(({ v, cols }) => {
          const isOpen = !!f || open.has(v.name);
          return (
            <li key={v.name} className="mb-1">
              <div className="flex items-center gap-1">
                <button onClick={() => toggle(v.name)} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${v.name}`} className="w-5 text-muted-foreground">{isOpen ? "▾" : "▸"}</button>
                <button onClick={() => insert(v.name)} title="Insert view name" className="font-mono font-semibold text-accent hover:underline">{v.name}</button>
                <span className="text-xs text-muted-foreground">{v.columns.length}</span>
              </div>
              {isOpen && (
                <div className="ml-5 border-l border-border pl-2">
                  <p className="my-1 text-xs text-muted-foreground">{v.description}</p>
                  <button onClick={() => preview(v.name)} className="mb-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted">Preview 10 rows</button>
                  {v.joins.length > 0 && (
                    <details className="mb-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Joins</summary>
                      <ul className="mt-1 space-y-1 font-mono">{v.joins.map((j) => <li key={j}>{j}</li>)}</ul>
                    </details>
                  )}
                  <ul>
                    {cols.map((c) => (
                      <li key={c.name} className="py-0.5">
                        <button onClick={() => insert(c.name)} title={c.example ? `Example: ${c.example}` : "Insert column"} className="text-left hover:bg-muted">
                          <span className="font-mono">{c.name}</span> <span className="font-mono text-xs text-muted-foreground">{c.type}</span>
                        </button>
                        <p className="text-xs text-muted-foreground">{c.description}{c.example && <> <span className="font-mono">e.g. {c.example}</span></>}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
        {!views.length && <li className="p-2 text-muted-foreground">Nothing matches.</li>}
      </ul>
    </section>
  );
}
