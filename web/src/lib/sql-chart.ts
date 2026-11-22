type Data = Record<string, string | number | null>[];
export type ChartSpec =
  | { kind: "line"; x: string; ys: string[]; data: Data; note?: string }
  | { kind: "bar"; x: string; ys: string[]; data: Data; note?: string };

const TOP = 5;

const ISO = /^\d{4}-\d{2}(-\d{2})?([T ]|$)/;
const nonNull = (rows: unknown[][], i: number) => rows.map((r) => r[i]).filter((v) => v != null);
const isNum = (rows: unknown[][], i: number) => nonNull(rows, i).length > 0 && nonNull(rows, i).every((v) => typeof v === "number");
const isDate = (rows: unknown[][], i: number) => nonNull(rows, i).length > 0 && nonNull(rows, i).every((v) => typeof v === "string" && ISO.test(v));
const isText = (rows: unknown[][], i: number) => nonNull(rows, i).length > 0 && nonNull(rows, i).every((v) => typeof v === "string") && !isDate(rows, i);

/**
 * One date column plus 1 to 3 numeric columns: line chart.
 * Otherwise a text column plus a numeric column: bar chart of the first numeric (top 20 rows).
 */
export function detectChart(columns: string[], rows: unknown[][]): ChartSpec | null {
  if (rows.length < 2) return null;
  const idx = columns.map((_, i) => i);
  const dates = idx.filter((i) => isDate(rows, i));
  const nums = idx.filter((i) => isNum(rows, i));
  const texts = idx.filter((i) => isText(rows, i));
  const build = (x: number, ys: number[], list: unknown[][]) =>
    list.map((r) => Object.fromEntries([[columns[x], r[x] as string], ...ys.map((y) => [columns[y], r[y] as number | null])]));

  // Long format (date, category, value): one line per category, the 5 with the most rows.
  if (columns.length === 3 && dates.length === 1 && texts.length === 1 && nums.length === 1) {
    const [d, t, v] = [dates[0], texts[0], nums[0]];
    const counts = new Map<string, number>();
    for (const r of rows) if (r[t] != null) counts.set(String(r[t]), (counts.get(String(r[t])) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, TOP).map(([k]) => k);
    // A category named like the date column must not overwrite the x key.
    const key = (c: string) => (c === columns[d] ? `${c} (series)` : c);
    const byDate = new Map<string, Record<string, string | number | null>>();
    for (const r of rows) {
      if (r[t] == null || !top.includes(String(r[t]))) continue;
      const dk = String(r[d]);
      const row = byDate.get(dk) ?? { [columns[d]]: dk };
      row[key(String(r[t]))] = (r[v] as number | null) ?? null;
      byDate.set(dk, row);
    }
    const data = [...byDate.values()].sort((a, b) => String(a[columns[d]]).localeCompare(String(b[columns[d]])));
    return { kind: "line", x: columns[d], ys: top.map(key), data, note: ranked.length > TOP ? `showing ${TOP} of ${ranked.length}` : undefined };
  }
  if (dates.length === 1 && nums.length >= 1 && nums.length <= 3) {
    const x = dates[0];
    const sorted = [...rows].sort((a, b) => String(a[x]).localeCompare(String(b[x])));
    return { kind: "line", x: columns[x], ys: nums.map((i) => columns[i]), data: build(x, nums, sorted) };
  }
  if (texts.length >= 1 && nums.length >= 1 && dates.length === 0) {
    // Nulls last, explicitly: -Infinity minus -Infinity would be NaN.
    const n = nums[0];
    const sorted = [...rows].sort((a, b) => (a[n] == null ? 1 : 0) - (b[n] == null ? 1 : 0) || ((b[n] as number) ?? 0) - ((a[n] as number) ?? 0)).slice(0, 20);
    return { kind: "bar", x: columns[texts[0]], ys: [columns[nums[0]]], data: build(texts[0], [nums[0]], sorted) };
  }
  return null;
}
