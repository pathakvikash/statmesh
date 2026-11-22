// Pure helpers for the "Details" view under an answer: paging, which columns to show, readable cells,
// and a table view of each tool result. No React, no I/O.
import { formatValue } from "@/lib/format";

export const PAGE_SIZE = 5;

export type Page = { from: number; to: number; total: number; pages: number; page: number; start: number };

/** Row window for a 0-based page, clamped. `from`/`to` are 1-based for "1–5 of 12"; `start` is the slice offset. */
export function pageSlice(total: number, page: number, size = PAGE_SIZE): Page {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  const start = p * size;
  return { from: total ? start + 1 : 0, to: Math.min(total, start + size), total, pages, page: p, start };
}

/** Provenance columns that clutter a table; shown only with "Show all columns". */
export const ID_COLUMNS = new Set(["series_id", "source_id", "dataset_id", "indicator_id", "unit_mult"]);

const empty = (v: unknown) => v === null || v === undefined || v === "" || v === "n/a";

export type Cells = { headers: string[]; rows: string[][]; hidden: number };

export function formatCell(v: unknown): string {
  if (empty(v)) return "";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Display cells. By default: id columns and all-empty columns are dropped, and a `unit` column is folded into
 * `value` ("5.2 %"). `hidden` counts what was left out, so the toggle can say so.
 */
export function displayCells(columns: string[], rows: unknown[][], showAll: boolean): Cells {
  const iv = columns.indexOf("value"), iu = columns.indexOf("unit"), im = columns.indexOf("unit_mult");
  const fold = !showAll && iv >= 0 && iu >= 0;
  const keep = columns.map((c, i) => {
    if (showAll) return true;
    if (ID_COLUMNS.has(c)) return false;
    if (fold && c === "unit") return false;
    return rows.some((r) => !empty(r[i]));
  });
  // Never show nothing: if every column would be hidden, fall back to all of them.
  const idx = columns.flatMap((_, i) => (keep[i] ? [i] : []));
  const use = idx.length ? idx : columns.map((_, i) => i);
  const cell = (r: unknown[], i: number) =>
    fold && i === iv ? (empty(r[i]) ? "" : formatValue(r[i], empty(r[iu]) ? null : String(r[iu]), im >= 0 && typeof r[im] === "number" ? (r[im] as number) : null)) : formatCell(r[i]);
  return { headers: use.map((i) => columns[i]), rows: rows.map((r) => use.map((i) => cell(r, i))), hidden: columns.length - use.length };
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);

/** A tool result as columns and rows, or null when it is not tabular (the row then shows its text summary). */
export function tabulate(output: unknown): { columns: string[]; rows: unknown[][] } | null {
  const o = rec(output);
  if (!o) return null;
  if (Array.isArray(o.columns) && Array.isArray(o.rows)) return { columns: o.columns.map(String), rows: o.rows as unknown[][] };
  if (Array.isArray(o.hits)) {
    const columns = ["series_id", "title", "geo", "freq", "start", "end", "unit", "source_id"];
    return { columns, rows: o.hits.map((h) => columns.map((c) => rec(h)?.[c])) };
  }
  if (typeof o.series_id === "string" && typeof o.title === "string") {
    const scalars = Object.entries(o).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) && !empty(v));
    return { columns: ["field", "value"], rows: scalars.map(([k, v]) => [k, v]) };
  }
  return null;
}

/** Short attribution line: the distinct attribution strings of the cited sources. */
export function attributionLine(cites: { attribution?: string; source_name?: string }[]): string {
  const seen = new Set<string>();
  for (const c of cites) {
    const t = (c.attribution || c.source_name || "").trim();
    if (t) seen.add(t.replace(/\.$/, ""));
  }
  return [...seen].join("; ");
}
