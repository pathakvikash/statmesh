import type { SqlResult } from "./client";

type Cite = SqlResult["citations"][number];

/** "mospi:plfs_annual:ur:IND" -> "mospi/plfs_annual" (null if it is not a series key). */
const dsOf = (v: unknown) => {
  const p = typeof v === "string" ? v.split(":") : [];
  return p.length >= 3 ? `${p[0]}/${p[1]}` : null;
};

/**
 * The API cites every dataset of a source when the SQL names the source (source_id = 'mospi').
 * Keep only the datasets that appear in the rows; with no series_id or source_id+dataset_id
 * column there is nothing to narrow by, so keep them all.
 */
export function citedInRows(res: Pick<SqlResult, "columns" | "rows" | "citations">): Cite[] {
  const ix = (n: string) => res.columns.indexOf(n);
  const [s, d, ser] = [ix("source_id"), ix("dataset_id"), ix("series_id")];
  let used: Set<string>;
  if (s >= 0 && d >= 0) used = new Set(res.rows.map((r) => `${r[s]}/${r[d]}`));
  else if (ser >= 0) used = new Set(res.rows.map((r) => dsOf(r[ser])).filter((x): x is string => !!x));
  else return res.citations;
  return res.citations.filter((c) => used.has(`${c.source_id}/${c.dataset_id}`));
}

/** The API warning names datasets; show it only if one of the shown citations is among them. */
export function partialNotice(warning: string | null | undefined, shown: Cite[]): { text: string; datasets: string[] } | null {
  if (!warning) return null;
  const listed = (warning.split(": ").pop() ?? "").split(", ").map((x) => x.trim()).filter(Boolean);
  if (!/^partial result/i.test(warning)) return { text: warning, datasets: [] };
  const mine = listed.filter((l) => shown.some((c) => `${c.source_id}/${c.dataset_id}` === l));
  return mine.length ? { text: "Some of the data behind this table is incomplete, so totals or trends may be missing parts.", datasets: mine } : null;
}

export const rowsLabel = (n: number) => `${n.toLocaleString("en-IN")} ${n === 1 ? "row" : "rows"}`;

export const NO_CHART = "This table can't be drawn as a chart because it needs a date or name column next to a number column.";
