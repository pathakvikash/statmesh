export type ChartSpec =
  | { kind: "line"; x: string; ys: string[]; data: Record<string, string | number | null>[] }
  | { kind: "bar"; x: string; ys: string[]; data: Record<string, string | number | null>[] };

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

  if (dates.length === 1 && nums.length >= 1 && nums.length <= 3) {
    const x = dates[0];
    const sorted = [...rows].sort((a, b) => String(a[x]).localeCompare(String(b[x])));
    return { kind: "line", x: columns[x], ys: nums.map((i) => columns[i]), data: build(x, nums, sorted) };
  }
  if (texts.length >= 1 && nums.length >= 1 && dates.length === 0) {
    const sorted = [...rows].sort((a, b) => ((b[nums[0]] as number) ?? -Infinity) - ((a[nums[0]] as number) ?? -Infinity)).slice(0, 20);
    return { kind: "bar", x: columns[texts[0]], ys: [columns[nums[0]]], data: build(texts[0], [nums[0]], sorted) };
  }
  return null;
}
