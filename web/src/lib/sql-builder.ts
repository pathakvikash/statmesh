import { sqlList, sqlLiteral } from "./sql";

export type Show = "latest" | "trend" | "compare" | "topN";
export type BuildQuery = {
  seriesKey: string; // source:dataset:indicator
  title: string;
  unit?: string;
  geos: string[];
  fromYear?: number;
  toYear?: number;
  show: Show;
  n?: number;
  /** Optional: geo code -> display name, for the sentence only. */
  geoNames?: Record<string, string>;
  /** Optional: A, Q, M, W or D; only changes the wording ("each year", "each month"). */
  freq?: string;
  /** Optional: keep one breakdown, e.g. { sex: "total" }; "" keeps rows without that breakdown. Keys are letters, digits or underscore. */
  dims?: Record<string, string>;
};

const LIMIT = 5000;
const FREQ: Record<string, string> = { A: "year", S: "half-year", Q: "quarter", M: "month", W: "week", D: "day" };
const COLS = "series_id, geo, period_start, value, unit, dims";
// Last row per country (and per breakdown) inside the filter. The mode picks from this fixed map; no user text becomes SQL structure.
const LAST = "QUALIFY row_number() OVER (PARTITION BY geo, CAST(dims AS VARCHAR) ORDER BY period_start DESC) = 1";
// Highest places: one row per place (its latest period, then its largest breakdown), so a place cannot fill the list several times.
const LAST_PER_GEO = "QUALIFY row_number() OVER (PARTITION BY geo ORDER BY period_start DESC, value DESC NULLS LAST) = 1";
// Regional and unmapped aggregates are not places.
const NO_AGGREGATES = "geo NOT LIKE 'region:%' AND geo NOT LIKE 'unmapped:%'";
const TAIL: Record<Show, (n: number) => string> = {
  trend: () => `ORDER BY geo, period_start\nLIMIT ${LIMIT}`,
  compare: () => `ORDER BY period_start, geo\nLIMIT ${LIMIT}`,
  latest: () => `${LAST}\nORDER BY geo\nLIMIT ${LIMIT}`,
  topN: (n) => `${LAST_PER_GEO}\nORDER BY value DESC NULLS LAST\nLIMIT ${n}`,
};

const year = (y: number | undefined, label: string): number | undefined => {
  if (y === undefined) return undefined;
  if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new RangeError(`${label} must be a whole year between 1900 and 2100`);
  return y;
};

const list = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function buildQuery(q: BuildQuery): { sql: string; sentence: string } {
  const parts = q.seriesKey.split(":");
  if (parts.length !== 3 || parts.some((p) => !p.trim())) throw new Error("Pick an indicator first");
  if (!(q.show in TAIL)) throw new Error("Unknown way to show the data");
  const from = year(q.fromYear, "From year");
  const to = year(q.toYear, "To year");
  if (from !== undefined && to !== undefined && from > to) throw new RangeError("From year must not be after To year");
  const n = Math.min(100, Math.max(1, Number.isFinite(q.n) ? Math.trunc(q.n!) : 10));
  const geos = q.geos.map((g) => g.trim()).filter(Boolean).slice(0, 50);

  const where = [`source_id = ${sqlLiteral(parts[0])}`, `dataset_id = ${sqlLiteral(parts[1])}`, `indicator_id = ${sqlLiteral(parts[2])}`];
  if (geos.length) where.push(`geo IN (${sqlList(geos)})`);
  else if (q.show === "topN") where.push(NO_AGGREGATES);
  if (from !== undefined) where.push(`year(period_start) >= ${from}`);
  if (to !== undefined) where.push(`year(period_start) <= ${to}`);
  for (const [k, v] of Object.entries(q.dims ?? {})) {
    if (!/^\w{1,40}$/.test(k)) throw new Error("Bad breakdown name");
    // An empty value means "this breakdown is absent", which keeps the plain total next to its breakdowns.
    where.push(v === "" ? `dims[${sqlLiteral(k)}] IS NULL` : `dims[${sqlLiteral(k)}] = ${sqlLiteral(v)}`);
  }
  const sql = `SELECT ${COLS}\nFROM observations\nWHERE ${where.join("\n  AND ")}\n${TAIL[q.show](n)}`;

  const what = `${q.title.trim() || "this indicator"}${q.unit ? ` (${q.unit})` : ""}`;
  const names = geos.map((g) => q.geoNames?.[g] ?? g);
  const where_ = names.length ? ` for ${list(names)}` : " for every country";
  const when = from !== undefined && to !== undefined ? ` from ${from} to ${to}` : from !== undefined ? ` from ${from} onwards` : to !== undefined ? ` up to ${to}` : "";
  const each = `each ${FREQ[q.freq ?? "A"] ?? "year"}`;
  const head = {
    trend: `Shows the ${what}${where_} ${each}${when}.`,
    compare: `Compares the ${what}${where_} ${each}${when}.`,
    latest: `Shows the latest ${what}${where_}${when}.`,
    topN: `Shows the ${n} highest values of the ${what}${names.length ? where_ : ""}, using the latest figure for each place${when}${q.dims && Object.keys(q.dims).length ? "" : " (if a place has breakdowns, only its largest is counted)"}.`,
  }[q.show];
  const dimNote = q.dims && Object.keys(q.dims).length ? "" : " If the data has breakdowns (such as men and women), each one is its own row.";
  return { sql, sentence: head + dimNote };
}

const BUILT = `SELECT ${COLS}\nFROM observations\nWHERE source_id = '`;
// One quoted literal, then ", '…'" repeats: the separator keeps '' unambiguous, so matching is linear.
const GEO_LINE = /^ {2}AND geo IN \('(?:[^']|'')*'(?:, '(?:[^']|'')*')*\)\n/gm;

/** True when the SQL has a geo IN (...) filter. */
export const hasGeoFilter = (sql: string): boolean => /\bgeo\s+IN\s*\(/i.test(sql);

/**
 * Drops the place filter, but only from SQL that buildQuery wrote (exact shape, one geo line); anything else returns null.
 * A highest-places query gets the no-aggregates guard buildQuery adds when no place is chosen.
 */
export function dropGeoFilter(sql: string): string | null {
  if (!sql.startsWith(BUILT) || (sql.match(GEO_LINE) ?? []).length !== 1) return null;
  return sql.replace(GEO_LINE, sql.includes("ORDER BY value DESC NULLS LAST") ? `  AND ${NO_AGGREGATES}\n` : "");
}
