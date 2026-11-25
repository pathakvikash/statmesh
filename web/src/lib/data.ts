// Server-only data helpers built on the read-only SQL view. Every id goes through sqlLiteral.
import { unstable_cache } from "next/cache";
import { search, sql, sources, type SeriesHit, type SourceStatus } from "./client";
import { unitLabel } from "./format";
import type { Filters } from "./params";
import { sqlList, sqlLiteral } from "./sql";
import { WORLD, dimsSql, geoSeriesSql, isMultiGeoKey, keyMatchSql, pickHeadline, sparkOf, type GeoVal, type Headline, type PeriodStat } from "./multigeo";
import { shapeFromAggregate, type Shape } from "./shape";
import { CORE_SLOTS, resolveCore, type CoreItem } from "./core-indicators";

export type Pt = { t: string; v: number };
export type SeriesStat = {
  id: string;
  title: string | null;
  source_id: string | null;
  geo: string | null;
  freq: string | null;
  unit: string | null;
  unitMult: number | null;
  start: string;
  end: string;
  retrieved: string;
  n: number;
  points: Pt[]; // chronological, last `limit` observations
  multi?: { geos: number; sub: boolean; headline: Headline | null; spark: "world" | "median" | "bars"; top: GeoVal[]; soleGeo?: string }; // 3-part keys: many geos
};

const records = (r: { columns: string[]; rows: unknown[][] }) =>
  r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) as Record<string, unknown>[];

// --- country names (geos view), cached 6h across lambdas ---------------------------------------
// Entries, not a Map: the cache stores JSON. Throws on failure or no rows so nothing empty is cached.
const cachedGeos = unstable_cache(async () => {
  const r = records(await sql("SELECT geo, name FROM geos ORDER BY name"));
  if (!r.length) throw new Error("geoNames: no rows");
  return r.map((g) => [String(g.geo), String(g.name)] as [string, string]);
}, ["geo-names"], { revalidate: 6 * 3600 });
export async function geoNames(): Promise<Map<string, string>> {
  try {
    return new Map(await cachedGeos());
  } catch {
    return new Map();
  }
}
export const geoName = (names: Map<string, string>, code?: string | null) => (code ? (names.get(code) ?? code) : null);

// --- per-series stats -----------------------------------------------------------------------------
/**
 * One row per series_id: dominant frequency and the dims combo with most rows only (a series can mix
 * A/Q/S or several dims), one value per period,
 * last `limit` points. `where` must be built with sqlLiteral/sqlList.
 */
const statsSql = (where: string, limit: number) => `
WITH raw AS (
  SELECT series_id, freq, period_start, CAST(dims AS VARCHAR) AS dk, source_id, dataset_id, indicator_id, geo,
         value, retrieved_at, unit, unit_mult
  FROM observations WHERE value IS NOT NULL AND (${where})
), f AS (
  SELECT series_id, freq FROM (
    SELECT series_id, freq, row_number() OVER (PARTITION BY series_id ORDER BY count(*) DESC, freq) AS rk
    FROM raw GROUP BY series_id, freq) WHERE rk = 1
), d AS (
  SELECT series_id, dk FROM (
    SELECT r.series_id, r.dk, row_number() OVER (PARTITION BY r.series_id ORDER BY count(*) DESC, r.dk) AS rk
    FROM raw r JOIN f ON r.series_id = f.series_id AND r.freq IS NOT DISTINCT FROM f.freq
    GROUP BY r.series_id, r.dk) WHERE rk = 1
), o AS (
  SELECT r.series_id, r.freq, r.period_start, any_value(r.source_id) AS source_id, any_value(r.dataset_id) AS dataset_id,
         any_value(r.indicator_id) AS indicator_id, any_value(r.geo) AS geo,
         arg_max(r.value, r.retrieved_at) AS v, max(r.retrieved_at) AS ra,
         arg_max(r.unit, r.retrieved_at) AS unit, arg_max(r.unit_mult, r.retrieved_at) AS um
  FROM raw r JOIN f ON r.series_id = f.series_id AND r.freq IS NOT DISTINCT FROM f.freq
  JOIN d ON r.series_id = d.series_id AND r.dk IS NOT DISTINCT FROM d.dk
  GROUP BY r.series_id, r.freq, r.period_start
), p AS (
  SELECT o.*, row_number() OVER (PARTITION BY o.series_id ORDER BY o.period_start DESC) AS rn FROM o
)
SELECT series_id, any_value(freq) AS freq, any_value(source_id) AS source_id, any_value(dataset_id) AS dataset_id,
       any_value(indicator_id) AS indicator_id, any_value(geo) AS geo,
       min(CAST(period_start AS VARCHAR)) AS start_d, max(CAST(period_start AS VARCHAR)) AS end_d,
       max(ra) AS retrieved, count(*) AS n,
       arg_max(unit, period_start) AS unit, arg_max(um, period_start) AS um,
       list(CAST(period_start AS VARCHAR) ORDER BY period_start) FILTER (WHERE rn <= ${limit}) AS ts,
       list(v ORDER BY period_start) FILTER (WHERE rn <= ${limit}) AS vs
FROM p GROUP BY series_id`;

function toStat(r: Record<string, unknown>): SeriesStat {
  const ts = (r.ts as string[] | null) ?? [], vs = (r.vs as number[] | null) ?? [];
  return {
    id: String(r.series_id), title: (r.title as string) ?? null, source_id: (r.source_id as string) ?? null,
    geo: (r.geo as string) ?? null, freq: (r.freq as string) ?? null, unit: unitLabel(r.unit as string | null) || null,
    unitMult: (r.um as number) ?? null, start: String(r.start_d), end: String(r.end_d),
    retrieved: String(r.retrieved), n: Number(r.n), points: ts.map((t, i) => ({ t, v: vs[i] })),
  };
}

/**
 * Multi-geo stats: observations of key `k` are the rows whose series_id starts with `k:` (or, with no key
 * list, every `source:dataset:indicator` group). One row per key: per-period median/count/World lists,
 * plus the top 5 countries of the best-covered recent period. Dominant freq and dims only.
 */
const multiStatsSql = (keys: string[] | null, limit: number) => `
WITH raw AS (
  SELECT o.source_id || ':' || o.dataset_id || ':' || o.indicator_id AS key, o.source_id, o.dataset_id, o.indicator_id, o.geo, o.period_start, o.freq,
         CAST(o.dims AS VARCHAR) AS dk, o.value, o.retrieved_at, o.unit, o.unit_mult
  FROM observations o
  WHERE o.value IS NOT NULL AND o.geo IS NOT NULL AND ${keys ? `o.source_id IN (${sqlList([...new Set(keys.map((k) => k.split(":")[0]))])}) AND (${keyMatchSql("o.series_id", keys)})` : "o.source_id <> 'sec_edgar'"}
), f AS (
  SELECT key, freq FROM (SELECT key, freq, row_number() OVER (PARTITION BY key ORDER BY count(*) DESC, freq) AS rk FROM raw GROUP BY key, freq) WHERE rk = 1
), d AS (
  SELECT key, dk FROM (
    SELECT r.key, r.dk, row_number() OVER (PARTITION BY r.key ORDER BY count(*) DESC, r.dk) AS rk
    FROM raw r JOIN f ON r.key = f.key AND r.freq IS NOT DISTINCT FROM f.freq GROUP BY r.key, r.dk) WHERE rk = 1
), g AS (
  SELECT r.key, any_value(r.source_id) AS source_id, any_value(r.dataset_id) AS dataset_id, any_value(r.indicator_id) AS indicator_id, r.geo, r.period_start,
         arg_max(r.value, r.retrieved_at) AS v, max(r.retrieved_at) AS ra, any_value(r.freq) AS freq,
         arg_max(r.unit, r.retrieved_at) AS unit, arg_max(r.unit_mult, r.retrieved_at) AS um
  FROM raw r JOIN f ON r.key = f.key AND r.freq IS NOT DISTINCT FROM f.freq JOIN d ON r.key = d.key AND r.dk IS NOT DISTINCT FROM d.dk
  GROUP BY r.key, r.geo, r.period_start
), c AS (SELECT * FROM g WHERE NOT starts_with(geo, 'region:') AND NOT starts_with(geo, 'unmapped:')),
per AS (SELECT key, period_start, median(v) AS med, count(*) AS n FROM c GROUP BY key, period_start),
w AS (SELECT key, period_start, v FROM g WHERE geo = '${WORLD}'),
pw AS (
  SELECT a.key, a.period_start, p.med, coalesce(p.n, 0) AS n, w.v AS wv, row_number() OVER (PARTITION BY a.key ORDER BY a.period_start DESC) AS rn
  FROM (SELECT DISTINCT key, period_start FROM g) a
  LEFT JOIN per p ON a.key = p.key AND a.period_start = p.period_start
  LEFT JOIN w ON a.key = w.key AND a.period_start = w.period_start
), hp AS (
  SELECT key, max(period_start) AS p FROM per WHERE n * 2 >= (SELECT max(n) FROM per x WHERE x.key = per.key) GROUP BY key
), top AS (
  SELECT c.key, c.geo, c.v, row_number() OVER (PARTITION BY c.key ORDER BY c.v DESC, c.geo) AS rk
  FROM c JOIN hp ON c.key = hp.key AND c.period_start = hp.p
), meta AS (
  SELECT key, any_value(source_id) AS source_id, any_value(dataset_id) AS dataset_id, any_value(indicator_id) AS indicator_id, any_value(freq) AS freq,
         count(DISTINCT geo) FILTER (WHERE NOT starts_with(geo, 'region:') AND NOT starts_with(geo, 'unmapped:')) AS geos,
         count(DISTINCT geo) FILTER (WHERE regexp_matches(geo, '^[A-Z]{2}-')) AS subgeos,
         min(CAST(period_start AS VARCHAR)) AS start_d, max(CAST(period_start AS VARCHAR)) AS end_d, max(ra) AS retrieved,
         arg_max(unit, period_start) AS unit, arg_max(um, period_start) AS um
  FROM g GROUP BY key
)
SELECT m.key AS series_id, m.source_id, m.dataset_id, m.indicator_id, m.freq, m.geos, m.subgeos, m.start_d, m.end_d, m.retrieved, m.unit, m.um,
       a.ts, a.med, a.ns, a.wv, t.tg, t.tv
FROM meta m
LEFT JOIN (SELECT key, list(CAST(period_start AS VARCHAR) ORDER BY period_start) AS ts, list(med ORDER BY period_start) AS med,
                  list(n ORDER BY period_start) AS ns, list(wv ORDER BY period_start) AS wv FROM pw WHERE rn <= ${limit} GROUP BY key) a ON a.key = m.key
LEFT JOIN (SELECT key, list(geo ORDER BY rk) AS tg, list(v ORDER BY rk) AS tv FROM top WHERE rk <= 5 GROUP BY key) t ON t.key = m.key`;

function toMultiStat(r: Record<string, unknown>): SeriesStat {
  const ts = (r.ts as string[] | null) ?? [], med = (r.med as (number | null)[]) ?? [], ns = (r.ns as number[]) ?? [], wv = (r.wv as (number | null)[]) ?? [];
  const tg = (r.tg as string[] | null) ?? [], tv = (r.tv as number[] | null) ?? [];
  const periods: PeriodStat[] = ts.map((t, i) => ({ t, med: med[i] ?? null, n: ns[i] ?? 0, w: wv[i] ?? null }));
  const geos = Number(r.geos), top = tg.map((geo, i) => ({ geo, v: tv[i] }));
  const soleGeo = geos === 1 ? tg[0] : undefined;
  const spark = sparkOf(periods);
  return {
    id: String(r.series_id), title: (r.title as string) ?? null, source_id: (r.source_id as string) ?? null, geo: null,
    freq: (r.freq as string) ?? null, unit: unitLabel(r.unit as string | null) || null, unitMult: (r.um as number) ?? null,
    start: String(r.start_d), end: String(r.end_d), retrieved: String(r.retrieved), n: ts.length, points: spark.points,
    multi: { geos, sub: Number(r.subgeos) * 2 > geos, headline: pickHeadline(periods, soleGeo), spark: spark.kind, top, soleGeo },
  };
}

/** Stats for the hits of one results page: one query, plus one for 3-part keys (multi-geo). Returns {} when nothing is ingested. */
export async function hitStats(ids: string[], limit = 60): Promise<Record<string, SeriesStat>> {
  if (!ids.length) return {};
  const out: Record<string, SeriesStat> = {};
  try {
    const r = await sql(statsSql(`series_id IN (${sqlList(ids)})`, limit));
    for (const x of records(r)) out[String(x.series_id)] = toStat(x);
  } catch { /* cards degrade to metadata only */ }
  const keys = ids.filter((i) => isMultiGeoKey(i) && !out[i]);
  if (keys.length) {
    try {
      for (const x of records(await sql(multiStatsSql(keys, limit)))) if (x.ts) out[String(x.series_id)] = toMultiStat(x);
    } catch { /* same */ }
  }
  return out;
}

/** Per-indicator recency/coverage of catalogued sources only (skips the huge faostat; sec_edgar skipped, its mixed dims make noisy sparklines). */
const indicatorScan = `
  SELECT source_id, dataset_id, indicator_id, max(retrieved_at) AS ra, count(DISTINCT geo) AS g, count(DISTINCT period_start) AS np
  FROM observations WHERE value IS NOT NULL AND geo IS NOT NULL AND source_id IN (SELECT source_id FROM series WHERE source_id <> 'sec_edgar')
  GROUP BY ALL HAVING count(DISTINCT period_start) >= 3 OR count(DISTINCT geo) >= 3`;

/** Newest-retrieved catalog indicators with >=3 periods or geos, `perSource` per source. */
export const candidateKeysSql = (perSource = 2) => `
SELECT s.series_key, s.title FROM (${indicatorScan}) o
JOIN series s ON s.source_id = o.source_id AND s.dataset_id = o.dataset_id AND s.indicator_id = o.indicator_id
WHERE s.title IS NOT NULL
QUALIFY row_number() OVER (PARTITION BY o.source_id ORDER BY o.ra DESC, o.g DESC, s.series_key) <= ${Math.trunc(perSource)}`;

/** The catalogued indicator covering the most countries (>=2, >=3 periods). */
export const featuredPickSql = () => `
SELECT source_id, dataset_id, indicator_id, g FROM (${indicatorScan}) WHERE g >= 2 AND np >= 3
ORDER BY g DESC, source_id, dataset_id, indicator_id LIMIT 1`;

/** One representative indicator per source (>=3 periods or countries), newest retrieved first. Probes a few candidate keys, never scans all observations. */
export async function latestUpdates(count = 6): Promise<SeriesStat[]> {
  const cand = records(await sql(candidateKeysSql()));
  const titles = new Map(cand.map((c) => [String(c.series_key), String(c.title)]));
  const stats = titles.size ? records(await sql(multiStatsSql([...titles.keys()], 24)))
    .filter((r) => r.ts && ((r.ts as unknown[]).length >= 3 || Number(r.geos) >= 3))
    .map((r) => ({ ...toMultiStat(r), title: titles.get(String(r.series_id)) ?? null }))
    .sort((a, b) => b.retrieved.localeCompare(a.retrieved) || (b.multi?.geos ?? 0) - (a.multi?.geos ?? 0) || a.id.localeCompare(b.id)) : [];
  if (!stats.length) throw new Error("latestUpdates: no candidates"); // throws, so unstable_cache never stores an empty result
  return [...newestBySource(stats).values()].slice(0, Math.trunc(count));
}

/** Run a cached loader outside the cache: a failure or empty result renders the page without that section. */
export async function orElse<T>(name: string, f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.warn(`${name} failed`, e);
    return fallback;
  }
}

export type GeoLatest = { geo: string; lp: string; v: number; n: number };
export type GeoInfo = { rows: GeoLatest[]; periods: number; freq: string | null; dk: string | null; unit: string | null; rawUnit: string | null; unitMult: number | null; retrieved: string };

/**
 * Per-geo latest value for one multi-geo key (dominant freq; dominant dims combo, or the chosen `sel` values):
 * at most one row per geo, so it never hits the row cap.
 */
export async function geoLatest(key: string, sel?: Record<string, string>): Promise<GeoInfo | null> {
  try {
    const r = records(await sql(`
WITH raw AS (SELECT geo, period_start, freq, CAST(dims AS VARCHAR) AS dk, dims, value, retrieved_at, unit, unit_mult FROM observations
  WHERE (${keyMatchSql("series_id", [key])}) AND value IS NOT NULL AND geo IS NOT NULL ${sel ? `AND ${dimsSql(sel)}` : ""}),
f AS (SELECT freq FROM raw GROUP BY freq ORDER BY count(*) DESC, freq LIMIT 1),
d AS (SELECT dk FROM raw JOIN f ON raw.freq IS NOT DISTINCT FROM f.freq GROUP BY dk ORDER BY count(*) DESC, dk LIMIT 1),
g AS (SELECT geo, period_start, any_value(freq) AS freq, any_value(dk) AS dk, arg_max(value, retrieved_at) AS v, max(retrieved_at) AS ra,
        arg_max(unit, retrieved_at) AS unit, arg_max(unit_mult, retrieved_at) AS um
      FROM raw WHERE freq IS NOT DISTINCT FROM (SELECT freq FROM f) ${sel ? "" : "AND dk IS NOT DISTINCT FROM (SELECT dk FROM d)"} GROUP BY geo, period_start)
SELECT geo, CAST(max(period_start) AS VARCHAR) AS lp, arg_max(v, period_start) AS v, count(*) AS n, any_value(freq) AS freq, any_value(dk) AS dk,
  arg_max(unit, period_start) AS unit, arg_max(um, period_start) AS um, CAST(max(ra) AS VARCHAR) AS ra,
  (SELECT count(DISTINCT period_start) FROM g) AS np
FROM g GROUP BY geo ORDER BY geo`));
    if (!r.length) return null;
    return {
      rows: r.map((x) => ({ geo: String(x.geo), lp: String(x.lp), v: Number(x.v), n: Number(x.n) })), periods: Number(r[0].np),
      freq: (r[0].freq as string) ?? null, dk: (r[0].dk as string) ?? null, unit: unitLabel(r[0].unit as string | null) || null, rawUnit: (r[0].unit as string) ?? null,
      unitMult: (r[0].um as number) ?? null, retrieved: r.map((x) => String(x.ra)).sort().at(-1)!,
    };
  } catch {
    return null;
  }
}

/** (geo, period, value) rows for a multi-geo key, optionally for chosen geos only (<=10000 rows; callers keep it small). */
export async function geoRows(key: string, info: Pick<GeoInfo, "freq" | "dk">, geos?: string[], sel?: Record<string, string>) {
  const r = await sql(geoSeriesSql(key, info.freq, info.dk, geos, sel));
  return records(r).map((x) => ({ geo: String(x.geo), t: String(x.t), v: Number(x.v) }));
}

/** Median over countries (regions excluded) per period, only of values in the parent's unit and unit_mult of a multi-geo key: one grouped query, [] on failure. Computed, not stored. */
export async function medianByPeriod(key: string, info: Pick<GeoInfo, "freq" | "dk" | "rawUnit" | "unitMult">, sel?: Record<string, string>): Promise<{ t: string; med: number; n: number }[]> {
  try {
    const r = records(await sql(`SELECT t, quantile_cont(v, 0.5) AS med, count(*) AS n FROM (${geoSeriesSql(key, info.freq, info.dk, undefined, sel, { unit: info.rawUnit, mult: info.unitMult })})
WHERE NOT starts_with(geo, 'region:') AND NOT starts_with(geo, 'unmapped:') GROUP BY t ORDER BY t`));
    return r.map((x) => ({ t: String(x.t), med: Number(x.med), n: Number(x.n) })).filter((x) => Number.isFinite(x.med));
  } catch {
    return [];
  }
}

/**
 * Shape of one series key (3-part `source:dataset:indicator`, or a 4-part id for one geo) in one query:
 * row/geo/period counts, frequencies and units by count, dimension values by count, and the dataset status.
 * Null when the query fails (the page then decides from the observations alone).
 */
export async function seriesShape(key: string): Promise<Shape | null> {
  const k3 = key.split(":").slice(0, 3).join(":");
  const exact = sqlLiteral(key), prefix = sqlLiteral(`${key}:`);
  try {
    const [r] = records(await sql(`
WITH o AS (
  SELECT geo, CAST(period_start AS VARCHAR) AS t, freq, unit, dims FROM observations
  WHERE value IS NOT NULL AND (series_id = ${exact} OR starts_with(series_id, ${prefix}))
), dv AS (
  SELECT k, CAST(element_at(dims, k)[1] AS VARCHAR) AS v FROM (SELECT unnest(map_keys(dims)) AS k, dims FROM o WHERE dims IS NOT NULL)
), dvn AS (SELECT k, v, count(*) AS n FROM dv WHERE v IS NOT NULL GROUP BY k, v),
dimagg AS (SELECT k, list(v ORDER BY n DESC, v) AS vs FROM dvn GROUP BY k)
SELECT
  (SELECT count(*) FROM o) AS n_rows,
  (SELECT count(DISTINCT geo) FROM o) AS geos,
  (SELECT count(DISTINCT t) FROM o) AS np,
  (SELECT min(t) FROM o) AS first_t,
  (SELECT max(t) FROM o) AS last_t,
  (SELECT list(freq ORDER BY n DESC, freq) FROM (SELECT freq, count(*) AS n FROM o WHERE freq IS NOT NULL GROUP BY freq)) AS freqs,
  (SELECT list(unit ORDER BY n DESC, unit) FROM (SELECT unit, count(*) AS n FROM o WHERE unit IS NOT NULL GROUP BY unit)) AS units,
  (SELECT list(k ORDER BY k) FROM dimagg) AS dim_k,
  (SELECT list(vs ORDER BY k) FROM dimagg) AS dim_vs,
  (SELECT d.status FROM series s JOIN datasets d ON d.source_id = s.source_id AND d.dataset_id = s.dataset_id
     WHERE s.series_key = ${sqlLiteral(k3)} LIMIT 1) AS status`));
    return shapeFromAggregate(r, r.status);
  } catch {
    return null;
  }
}

export type Featured = { title: string; unit: string | null; freq: string | null; sourceId: string; geos: string[]; rows: Record<string, number | string>[] };

/** One indicator compared across up to 5 countries: the indicator with the most countries having >=3 points. */
export async function featured(): Promise<Featured> {
  const pick = records(await sql(featuredPickSql()))[0];
  if (!pick) throw new Error("featured: no indicator"); // throws, so nothing empty is cached
  const where = ["source_id", "dataset_id", "indicator_id"].map((k) => `${k} = ${sqlLiteral(String(pick[k]))}`).join(" AND ");
  const r = await sql(`
SELECT st.*, s.title FROM (${statsSql(where, 120)}) st
LEFT JOIN series s ON s.source_id = st.source_id AND s.dataset_id = st.dataset_id AND s.indicator_id = st.indicator_id
WHERE st.n >= 3 ORDER BY (st.geo IN ('USA','IND','GBR','JPN','BRA','CHN','DEU','FRA')) DESC, st.n DESC, st.geo LIMIT 5`);
  const stats = records(r).map(toStat);
  if (stats.length < 2) throw new Error("featured: <2 geos");
  const byT = new Map<string, Record<string, number | string>>();
  for (const s of stats) for (const p of s.points) byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), [s.geo ?? s.id]: p.v });
  return {
    title: stats[0].title ?? String(pick.indicator_id), unit: unitLabel(stats[0].unit, stats[0].unitMult) || null, freq: stats[0].freq, sourceId: String(pick.source_id),
    geos: stats.map((s) => s.geo ?? s.id), rows: [...byT.values()].sort((a, b) => String(a.t).localeCompare(String(b.t))),
  };
}

// The unfiltered list changes only on ingest or config: cache it for an hour (errors are not cached).
export const allSources = unstable_cache(() => sources(), ["sources"], { revalidate: 3600 });

export async function sourceList(): Promise<SourceStatus[]> {
  try {
    return await allSources();
  } catch {
    return [];
  }
}

/** Results for any filter combination, empty query included: the API does the filtering. */
export async function findSeries(f: Filters): Promise<SeriesHit[]> {
  return (await search(f)).hits;
}

export type DatasetRow = { id: string; title: string; status: string | null; freq: string | null; lastIngested: string | null; series: number };

/** Datasets of one source with their series counts (largest first, 50 max). `id` goes through sqlLiteral. */
export const sourceDatasetsSql = (id: string) => `SELECT d.dataset_id, d.title, d.status, d.freq, d.last_ingested_at, count(s.series_key) AS series
FROM datasets d LEFT JOIN series s ON s.source_id = d.source_id AND s.dataset_id = d.dataset_id
WHERE d.source_id = ${sqlLiteral(id)} GROUP BY ALL ORDER BY series DESC, d.dataset_id LIMIT 50`;

export async function sourceDatasets(id: string): Promise<DatasetRow[]> {
  try {
    return records(await sql(sourceDatasetsSql(id))).map((r) => ({
      id: String(r.dataset_id), title: String(r.title ?? r.dataset_id), status: (r.status as string) ?? null,
      freq: (r.freq as string) ?? null, lastIngested: r.last_ingested_at ? String(r.last_ingested_at) : null, series: Number(r.series),
    }));
  } catch {
    return [];
  }
}

/** source_id -> its newest stat: the first seen wins, so pass stats ordered newest first (as latestUpdates returns them). */
export function newestBySource(stats: SeriesStat[]): Map<string, SeriesStat> {
  const m = new Map<string, SeriesStat>();
  for (const s of stats) if (s.source_id && !m.has(s.source_id)) m.set(s.source_id, s);
  return m;
}

/** One dataset row (title, status, series count) for a dataset-level search hit, or null. */
export async function datasetInfo(src: string, ds: string): Promise<DatasetRow | null> {
  try {
    const r = records(await sql(`SELECT d.dataset_id, d.title, d.status, d.freq, d.last_ingested_at, count(s.series_key) AS series
FROM datasets d LEFT JOIN series s ON s.source_id = d.source_id AND s.dataset_id = d.dataset_id
WHERE d.source_id = ${sqlLiteral(src)} AND d.dataset_id = ${sqlLiteral(ds)} GROUP BY ALL LIMIT 1`))[0];
    return r ? { id: String(r.dataset_id), title: String(r.title ?? r.dataset_id), status: (r.status as string) ?? null,
      freq: (r.freq as string) ?? null, lastIngested: r.last_ingested_at ? String(r.last_ingested_at) : null, series: Number(r.series) } : null;
  } catch {
    return null;
  }
}

// --- core indicators strip --------------------------------------------------------------------------
/** Resolved core indicators. Throws when fewer than 3 resolve, so unstable_cache never stores an empty strip. */
export async function coreIndicators(): Promise<CoreItem[]> {
  // ponytail: one stats query over every candidate (<=15 keys, 24 points each); split per slot if hosted WDI gets slow.
  const items = await resolveCore(CORE_SLOTS, (ids) => hitStats(ids, 24));
  if (!items.length) throw new Error("coreIndicators: fewer than 3 slots have data");
  return items;
}

/** The one cached core-indicators call: the strip and the home graph both read it, so a cold home runs it once. Throws when empty (never cached). */
export const cachedCore = unstable_cache(() => coreIndicators(), ["core-indicators"], { revalidate: 3600 });
