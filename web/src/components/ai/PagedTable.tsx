"use client";
import { useState } from "react";
import { displayCells, pageSlice } from "@/lib/chat/details";
import { Pager } from "./Pager";

/** A tool result as a small table: 5 rows a page, ids hidden unless asked, scrolls sideways, sticky header. */
export function PagedTable({ columns, rows, caption }: { columns: string[]; rows: unknown[][]; caption: string }) {
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(false);
  const cells = displayCells(columns, rows, all);
  const s = pageSlice(cells.rows.length, page);
  const canToggle = all || cells.hidden > 0;
  return (
    <div>
      <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>{cells.headers.map((h, i) => <th key={i} scope="col" className="sticky top-0 whitespace-nowrap border-b border-border bg-muted px-2 py-1 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {cells.rows.slice(s.start, s.start + 5).map((r, i) => (
              <tr key={s.start + i} className="odd:bg-muted/40">
                {r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1 tabular-nums">{c}</td>)}
              </tr>
            ))}
            {!cells.rows.length && <tr><td className="px-2 py-1 text-muted-foreground" colSpan={Math.max(1, cells.headers.length)}>No rows</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        {canToggle
          ? <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-xs text-accent underline">{all ? "Hide id columns" : `Show all columns (${cells.hidden} hidden)`}</button>
          : <span />}
        <Pager total={cells.rows.length} page={s.page} onPage={setPage} />
      </div>
    </div>
  );
}
