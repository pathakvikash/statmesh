"use client";
import { useId, useState } from "react";
import type { SqlSchema, SqlView } from "@/lib/sql-schema";
import { columnHelp, filterViews, isAdvancedTable, tableHelp } from "@/lib/sql-schema-help";

const tap = "min-h-10 inline-flex items-center rounded-md border border-border px-3 text-xs hover:bg-muted";

type Item = { v: SqlView; cols: SqlView["columns"] };

/** Plain-English schema browser. Props unchanged: insert adds a name to the editor, preview runs 10 rows. */
export function SchemaBrowser({ schema, live, insert, preview }: {
  schema: SqlSchema; live: boolean; insert: (s: string) => void; preview: (view: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["observations"]));
  const searchId = useId();
  const f = q.trim();
  const items = filterViews(schema.views, q);
  const main = items.filter(({ v }) => !isAdvancedTable(v.name));
  const more = items.filter(({ v }) => isAdvancedTable(v.name));
  const toggle = (n: string) => setOpen((s) => { const x = new Set(s); if (!x.delete(n)) x.add(n); return x; });

  const table = ({ v, cols }: Item) => {
    const isOpen = !!f || open.has(v.name);
    return (
      <li key={v.name} className="mb-2">
        <div className="flex items-center gap-1">
          <button onClick={() => toggle(v.name)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} columns of ${v.name}`} className="min-h-10 min-w-10 text-muted-foreground">{isOpen ? "▾" : "▸"}</button>
          <span className="font-mono font-semibold">{v.name}</span>
          <span className="text-xs text-muted-foreground">{v.columns.length} columns</span>
        </div>
        <p className="ml-10 text-xs text-muted-foreground">{tableHelp(v.name, v.description)}</p>
        {isOpen && (
          <div className="ml-10 mt-1 border-l border-border pl-2">
            <div className="mb-1 flex flex-wrap gap-1">
              <button onClick={() => preview(v.name)} className={tap}>Show 10 rows</button>
              <button onClick={() => insert(v.name)} className={tap}>Add table name to editor</button>
            </div>
            {v.joins.length > 0 && (
              <details className="mb-1 text-xs text-muted-foreground">
                <summary className="min-h-10 cursor-pointer py-2">How this links to other tables</summary>
                <ul className="mt-1 space-y-1 font-mono">{v.joins.map((j) => <li key={j} className="break-words">{j}</li>)}</ul>
              </details>
            )}
            <ul>
              {cols.map((c) => (
                <li key={c.name} className="border-b border-border py-1 last:border-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-mono">{c.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{c.type}</span>
                    <button onClick={() => insert(c.name)} aria-label={`Add column ${c.name} to editor`} className={tap}>Add</button>
                  </div>
                  {c.example && <p className="text-xs text-muted-foreground">Example: <span className="font-mono break-all">{c.example}</span></p>}
                  <details className="text-xs">
                    <summary className="min-h-10 cursor-pointer py-2 text-accent">What is this?</summary>
                    <p className="pb-1 text-muted-foreground">{columnHelp(c.name, c.description)}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
      </li>
    );
  };

  return (
    <section aria-label="Schema browser" className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border p-2">
        <h2 className="mb-1 text-sm font-semibold">Tables and columns</h2>
        <p className="mb-2 text-xs text-muted-foreground">Tables hold the data. Click a table to see its columns. You do not need this if you use Build a question.</p>
        <label htmlFor={searchId} className="sr-only">Search tables and columns</label>
        <input id={searchId} value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search tables and columns"
          className="min-h-10 w-full rounded-lg border border-border bg-background px-2 text-sm" />
        {!live && <p className="mt-1 text-xs text-muted-foreground">Showing the bundled schema; the API has no /schema route yet.</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1 text-sm">
        <ul>{main.map(table)}</ul>
        {more.length > 0 && (
          <details open={!!f} className="mt-2 border-t border-border pt-1">
            <summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold">More tables ({more.length}, mostly for developers)</summary>
            <ul>{more.map(table)}</ul>
          </details>
        )}
        {!items.length && <p className="p-2 text-muted-foreground">Nothing matches.</p>}
      </div>
    </section>
  );
}
