/** CSV cell. String cells starting with = + - @ tab or CR get a leading ' so spreadsheets do not run them as formulas. */
export const cell = (v: unknown): string => {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const toCsv = (columns: string[], rows: unknown[][]): string =>
  [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** Indian digit grouping (12,34,567); whole numbers 1000-2999 in year/fy/period/date columns stay plain (2024, not 2,024). */
export const fmtCell = (v: unknown, col: string): string => {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) && v >= 1000 && v <= 2999 && /year|fy|period|date|(^|_)yr$/i.test(col) ? String(v) : v.toLocaleString("en-IN", { maximumFractionDigits: 4 });
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

/** Header text: the `value` column gets the shared `unit` as a suffix, e.g. "value (%)". */
export function headerLabel(columns: string[], rows: unknown[][], col: string): string {
  const u = columns.indexOf("unit");
  if (col !== "value" || u < 0) return col;
  const units = new Set(rows.map((r) => r[u]).filter((x) => x != null && x !== ""));
  return units.size === 1 ? `${col} (${[...units][0]})` : col;
}

export type Sort = { col: number; dir: "asc" | "desc" } | null;

/** Click cycle for a header: none, asc, desc, none. */
export const nextSort = (s: Sort, col: number): Sort => (s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null);

/** Sorted copy; numbers numerically, text with natural collation, nulls always last. */
export function sortRows(rows: unknown[][], s: Sort): unknown[][] {
  if (!s) return rows;
  const k = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [x, y] = [a[s.col], b[s.col]];
    if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
    if (typeof x === "number" && typeof y === "number") return (x - y) * k;
    return String(x).localeCompare(String(y), undefined, { numeric: true }) * k;
  });
}

/** Absolute link that reopens and runs the query, or null when the SQL is empty or too long. */
export const shareLink = (origin: string, href: string | null): string | null => (href ? origin + href : null);
