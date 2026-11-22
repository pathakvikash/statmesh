"use client";
import { useMemo, useState } from "react";
import { Pager } from "@/components/ai/Pager";
import { pageSlice } from "@/lib/chat/details";
import { formatValue, type Citation } from "@/lib/format";
import { filterRows, sortRows, toJson, type Row } from "@/lib/obs-table";
import { btn } from "@/lib/ui";

const SIZE = 20;

/** Searchable, sortable, paged observations table with CSV (existing route) and JSON (from the rows served here) downloads. */
export function ObsExplorer({ id, columns, rows, citations, csvHref, caption }: {
  id: string; columns: string[]; rows: Row[]; citations: Citation[]; csvHref: string; caption: string;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const shown = useMemo(() => {
    const r = filterRows(rows, q);
    return sort ? sortRows(r, sort.col, sort.dir) : r;
  }, [rows, q, sort]);
  const s = pageSlice(shown.length, page, SIZE);
  const iv = columns.indexOf("value"), iu = columns.indexOf("unit");
  const cell = (r: Row, i: number) => (i === iv && iu >= 0 ? formatValue(r[i], r[iu] as string | null) : String(r[i] ?? ""));
  const toggle = (col: number) => { setSort((cur) => (cur?.col === col && cur.dir === "asc" ? { col, dir: "desc" } : { col, dir: "asc" })); setPage(0); };
  const downloadJson = () => {
    const url = URL.createObjectURL(new Blob([toJson(columns, rows, citations)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${id.replace(/[^\w.-]+/g, "_")}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={`Search ${rows.length} rows…`} aria-label="Search observations"
          className="min-w-48 flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm" />
        <a href={csvHref} download className={btn}>Download CSV</a>
        <button type="button" onClick={downloadJson} className={btn}>Download JSON</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="mb-1 text-left text-muted-foreground">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" aria-sort={sort?.col === i ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="border-b border-border px-2 py-1">
                  <button type="button" onClick={() => toggle(i)} className="font-medium hover:text-accent">
                    {c}{sort?.col === i ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(s.start, s.start + SIZE).map((r, i) => (
              <tr key={s.start + i} className="odd:bg-muted/50">{columns.map((c, j) => <td key={c} className="px-2 py-1 tabular-nums">{cell(r, j)}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-3 text-sm text-muted-foreground">No rows match &ldquo;{q}&rdquo;.</p>}
      </div>
      <Pager total={shown.length} page={s.page} onPage={setPage} size={SIZE} />
    </div>
  );
}
