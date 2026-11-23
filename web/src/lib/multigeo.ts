// Pure helpers for "multi-geo" series: a 3-part key `source:dataset:indicator` whose observations carry
// series_id `source:dataset:indicator:<geo>` (ISO3 or region:WLD). No server imports, so client code can use it.
import { sqlLiteral } from "./sql";

export type Pt = { t: string; v: number };
/** One period across countries: median + country count, plus the World value when present. */
export type PeriodStat = { t: string; med: number | null; n: number; w: number | null };
export type Headline = { kind: "world" | "median" | "geo"; value: number; period: string; count: number; geo?: string };
export type GeoVal = { geo: string; v: number };

export const WORLD = "region:WLD";
/** Aggregates and unmapped provider codes (OWID_ASI...) are not countries. */
export const isRegion = (g: string) => g.startsWith("region:") || g.startsWith("unmapped:");
export const isMultiGeoKey = (id: string) => id.split(":").length === 3;

/** SQL predicate matching observations of any 3-part key. starts_with, so `_`/`%` in keys are not wildcards. */
export const keyMatchSql = (col: string, keys: string[]) =>
  keys.length ? keys.map((k) => `starts_with(${col}, ${sqlLiteral(`${k}:`)})`).join(" OR ") : "false";

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Group (geo, period, value) rows into per-period stats; regions feed only the World value. */
export function periodsFromRows(rows: { geo: string; t: string; v: number }[]): PeriodStat[] {
  const by = new Map<string, { vs: number[]; w: number | null }>();
  for (const r of rows) {
    const e = by.get(r.t) ?? { vs: [], w: null };
    if (r.geo === WORLD) e.w = r.v;
    else if (!isRegion(r.geo)) e.vs.push(r.v);
    by.set(r.t, e);
  }
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([t, e]) => ({ t, med: median(e.vs), n: e.vs.length, w: e.w }));
}

/**
 * World aggregate when present; else the median of the latest period that has at least half as many
 * countries as the best-covered one (so a stray late country never becomes the headline).
 */
export function pickHeadline(periods: PeriodStat[], soleGeo?: string): Headline | null {
  const w = periods.filter((p) => p.w !== null).at(-1);
  if (w) return { kind: "world", value: w.w!, period: w.t, count: w.n };
  const withMed = periods.filter((p) => p.med !== null);
  const best = Math.max(0, ...withMed.map((p) => p.n));
  const p = withMed.filter((x) => x.n * 2 >= best).at(-1);
  if (!p) return null;
  return soleGeo && p.n === 1 ? { kind: "geo", value: p.med!, period: p.t, count: 1, geo: soleGeo } : { kind: "median", value: p.med!, period: p.t, count: p.n };
}

/** Subnational sets (US-CA, IN-MH) are states/regions, not countries: true when most geos look like `XX-...`. */
export const isSubnational = (geos: string[]) => geos.filter((g) => /^[A-Z]{2}-/.test(g)).length * 2 > geos.length;
export const geoNoun = (sub: boolean, n = 2) => (sub ? (n === 1 ? "state/region" : "states/regions") : n === 1 ? "country" : "countries");

export const headlineLabel = (h: Headline, name: (g: string) => string, sub = false) =>
  h.kind === "world" ? "World" : h.kind === "geo" ? name(h.geo!) : `${h.count} ${geoNoun(sub, h.count)}`;

/** Headline caption: a computed median says so ("Median of 51 countries (computed)"). */
export const headlineText = (h: Headline, name: (g: string) => string, sub = false) =>
  h.kind === "median" && h.count > 1 ? `Median of ${headlineLabel(h, name, sub)} (computed)` : headlineLabel(h, name, sub);

/** Sparkline source: World over time; else median per period (>=3 periods); else bars. A World headline never gets a median trend. */
export function sparkOf(periods: PeriodStat[]): { kind: "world" | "median" | "bars"; points: Pt[] } {
  const world = periods.filter((p) => p.w !== null).map((p) => ({ t: p.t, v: p.w! }));
  if (world.length >= 2) return { kind: "world", points: world };
  if (world.length) return { kind: "bars", points: [] };
  const med = periods.filter((p) => p.med !== null).map((p) => ({ t: p.t, v: p.med! }));
  return med.length >= 3 ? { kind: "median", points: med } : { kind: "bars", points: [] };
}

/** Few periods read best as a ranking of the latest one; many as lines over time. */
export const chartMode = (distinctPeriods: number): "bars" | "lines" => (distinctPeriods <= 3 ? "bars" : "lines");

/** World (when present) plus the `n` countries with the highest latest values. */
export function defaultGeos(latest: { geo: string; v: number; lp: string }[], n = 4): string[] {
  const top = latest.filter((g) => !isRegion(g.geo));
  const maxLp = top.reduce((m, g) => (g.lp > m ? g.lp : m), "");
  const fresh = top.filter((g) => g.lp === maxLp);
  const pool = fresh.length >= n ? fresh : top;
  const ranked = [...pool].sort((a, b) => b.v - a.v || a.geo.localeCompare(b.geo)).slice(0, n).map((g) => g.geo);
  return [...(latest.some((g) => g.geo === WORLD) ? [WORLD] : []), ...ranked];
}

/** Top/bottom ranking with a name filter. */
export function rankBars<T extends { name: string; v: number }>(rows: T[], dir: "top" | "bottom", q: string, limit = 20): T[] {
  const term = q.trim().toLowerCase();
  const f = term ? rows.filter((r) => r.name.toLowerCase().includes(term)) : rows;
  return [...f].sort((a, b) => (dir === "top" ? b.v - a.v : a.v - b.v) || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Long (geo, t, v) rows -> wide chart rows {t, IND: 1, "region:WLD": 2}, chronological. */
export function widen(rows: { geo: string; t: string; v: number }[]): Record<string, number | string>[] {
  const by = new Map<string, Record<string, number | string>>();
  for (const r of rows) by.set(r.t, { ...(by.get(r.t) ?? { t: r.t }), [r.geo]: r.v });
  return [...by.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
}

const eq = (col: string, v: string | null) => (v === null ? `${col} IS NULL` : `${col} = ${sqlLiteral(v)}`);

/** Predicate for a chosen dimension selection (missing dim counts as ""). Keys and values are literals. */
export const dimsSql = (sel: Record<string, string>): string =>
  Object.entries(sel).map(([k, v]) => `coalesce(element_at(dims, ${sqlLiteral(k)})[1], '') = ${sqlLiteral(v)}`).join(" AND ") || "true";

/**
 * Observations of one multi-geo key restricted to the dominant frequency and either the dominant dims combo
 * (dk) or the chosen dimension values (sel); one value per (geo, period).
 */
export const geoSeriesSql = (key: string, freq: string | null, dk: string | null, geos?: string[], sel?: Record<string, string>, unit?: { unit: string | null; mult: number | null }) => `
SELECT geo, CAST(period_start AS VARCHAR) AS t, arg_max(value, retrieved_at) AS v FROM observations
WHERE starts_with(series_id, ${sqlLiteral(`${key}:`)}) AND value IS NOT NULL AND ${eq("freq", freq)} ${unit ? `AND ${eq("unit", unit.unit)} AND ${unit.mult === null ? "unit_mult IS NULL" : `unit_mult = ${Number(unit.mult)}`}` : ""} AND ${sel ? dimsSql(sel) : eq("CAST(dims AS VARCHAR)", dk)}
${geos ? `AND geo IN (${geos.map((g) => sqlLiteral(g)).join(", ")})` : ""} GROUP BY geo, period_start ORDER BY period_start`;

/** Legend label of the median line; N is the number of countries (or states/regions when `sub`) behind the latest median. */
export const medianLabel = (n: number, sub = false): string => `Median of ${n} ${geoNoun(sub, n)} (computed)`;

/** Add the median as column `key` to chart rows, only at periods the rows already have. */
export function withMedian<R extends Record<string, number | string | null>>(rows: R[], med: { t: string; med: number }[], key: string): Record<string, number | string | null>[] {
  const m = new Map(med.map((x) => [x.t, x.med]));
  return rows.map((r) => (m.has(String(r.t)) ? { ...r, [key]: m.get(String(r.t)) } : r));
}
