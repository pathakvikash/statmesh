// Pure helpers for the series data table: search, sort, JSON export.
import type { Citation } from "./format";

export type Row = unknown[];
const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Rows where any cell contains q (case-insensitive). Empty q keeps all. */
export function filterRows(rows: Row[], q: string): Row[] {
  const n = q.trim().toLowerCase();
  return n ? rows.filter((r) => r.some((c) => text(c).toLowerCase().includes(n))) : rows;
}

/** Stable sort on one column: numbers numerically, strings by locale, null/empty always last. */
export function sortRows(rows: Row[], col: number, dir: "asc" | "desc"): Row[] {
  const s = dir === "asc" ? 1 : -1;
  const nil = (v: unknown) => v === null || v === undefined || v === "";
  return rows.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => {
    const x = a[col], y = b[col];
    if (nil(x) || nil(y)) return nil(x) && nil(y) ? i - j : nil(x) ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : text(x).localeCompare(text(y), undefined, { numeric: true });
    return c ? c * s : i - j;
  }).map(([r]) => r);
}

/** JSON export: rows as objects, plus the citations and licence they come with. */
export function toJson(columns: string[], rows: Row[], citations: Citation[]): string {
  return JSON.stringify({
    columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null]))),
    citations, licence: citations.map((c) => ({ name: c.licence_name, url: c.licence_url, redistribute: c.redistribute })),
  }, null, 2);
}
