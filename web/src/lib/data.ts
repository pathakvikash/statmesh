// Server-only data helpers built on the read-only SQL view. Every id goes through sqlLiteral.
import { unstable_cache } from "next/cache";
import { search, sql, sources, type SeriesHit, type SourceStatus } from "./client";
import { unitLabel } from "./format";
import type { Filters } from "./params";
import { sqlList, sqlLiteral } from "./sql";
import { WORLD, geoSeriesSql, isMultiGeoKey, keyMatchSql, pickHeadline, sparkOf, type GeoVal, type Headline, type PeriodStat } from "./multigeo";

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

// --- country names (geos view), memoised for 6h -------------------------------------------------
let geoMemo: { at: number; map: Map<string, string> } | undefined;
export async function geoNames(): Promise<Map<string, string>> {
  if (geoMemo && Date.now() - geoMemo.at < 6 * 3600_000) return geoMemo.map;
  try {
    const r = await sql("SELECT geo, name FROM geos ORDER BY name");
    const map = new Map(records(r).map((g) => [String(g.geo), String(g.name)]));
    geoMemo = { at: Date.now(), map };
    return map;
  } catch {
    return geoMemo?.map ?? new Map();
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
  WHERE o.value IS NOT NULL AND o.geo IS NOT NULL AND ${keys ? `(${keyMatchSql("o.series_id", keys)})` : "o.source_id <> 'sec_edgar'"}
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

/** Most recently retrieved indicators (>=3 periods or countries), one per source for variety; one stat per 3-part key. */
export async function latestUpdates(count = 6): Promise<SeriesStat[]> {
  try {
    // ponytail: sec_edgar mixes dimensions per period, which makes noisy sparklines; skipped.
    const r = await sql(`
SELECT st.*, s.title FROM (${multiStatsSql(null, 24)}) st
LEFT JOIN series s ON s.source_id = st.source_id AND s.dataset_id = st.dataset_id AND s.indicator_id = st.indicator_id
WHERE (len(st.ts) >= 3 OR st.geos >= 3) AND s.title IS NOT NULL
QUALIFY row_number() OVER (PARTITION BY st.source_id ORDER BY st.retrieved DESC, st.geos DESC, st.series_id) = 1
ORDER BY st.retrieved DESC LIMIT ${Math.trunc(count)}`);
    return records(r).map(toMultiStat);
  } catch {
    return [];
  }
}

export type GeoLatest = { geo: string; lp: string; v: number; n: number };
export type GeoInfo = { rows: GeoLatest[]; periods: number; freq: string | null; dk: string | null; unit: string | null; unitMult: number | null; retrieved: string };

/** Per-geo latest value for one multi-geo key (dominant freq/dims): at most one row per geo, so it never hits the row cap. */
export async function geoLatest(key: string): Promise<GeoInfo | null> {
  try {
    const r = records(await sql(`
WITH raw AS (SELECT geo, period_start, freq, CAST(dims AS VARCHAR) AS dk, value, retrieved_at, unit, unit_mult FROM observations
  WHERE (${keyMatchSql("series_id", [key])}) AND value IS NOT NULL AND geo IS NOT NULL),
f AS (SELECT freq FROM raw GROUP BY freq ORDER BY count(*) DESC, freq LIMIT 1),
d AS (SELECT dk FROM raw JOIN f ON raw.freq IS NOT DISTINCT FROM f.freq GROUP BY dk ORDER BY count(*) DESC, dk LIMIT 1),
g AS (SELECT geo, period_start, any_value(freq) AS freq, any_value(dk) AS dk, arg_max(value, retrieved_at) AS v, max(retrieved_at) AS ra,
        arg_max(unit, retrieved_at) AS unit, arg_max(unit_mult, retrieved_at) AS um
      FROM raw WHERE freq IS NOT DISTINCT FROM (SELECT freq FROM f) AND dk IS NOT DISTINCT FROM (SELECT dk FROM d) GROUP BY geo, period_start)
SELECT geo, CAST(max(period_start) AS VARCHAR) AS lp, arg_max(v, period_start) AS v, count(*) AS n, any_value(freq) AS freq, any_value(dk) AS dk,
  arg_max(unit, period_start) AS unit, arg_max(um, period_start) AS um, CAST(max(ra) AS VARCHAR) AS ra,
  (SELECT count(DISTINCT period_start) FROM g) AS np
FROM g GROUP BY geo ORDER BY geo`));
    if (!r.length) return null;
    return {
      rows: r.map((x) => ({ geo: String(x.geo), lp: String(x.lp), v: Number(x.v), n: Number(x.n) })), periods: Number(r[0].np),
      freq: (r[0].freq as string) ?? null, dk: (r[0].dk as string) ?? null, unit: unitLabel(r[0].unit as string | null) || null,
      unitMult: (r[0].um as number) ?? null, retrieved: r.map((x) => String(x.ra)).sort().at(-1)!,
    };
  } catch {
    return null;
  }
}

/** (geo, period, value) rows for a multi-geo key, optionally for chosen geos only (<=10000 rows; callers keep it small). */
export async function geoRows(key: string, info: Pick<GeoInfo, "freq" | "dk">, geos?: string[]) {
  const r = await sql(geoSeriesSql(key, info.freq, info.dk, geos));
  return records(r).map((x) => ({ geo: String(x.geo), t: String(x.t), v: Number(x.v) }));
}

export type Featured = { title: string; unit: string | null; freq: string | null; sourceId: string; geos: string[]; rows: Record<string, number | string>[] };

/** One indicator compared across up to 5 countries: the indicator with the most countries having >=3 points. */
export async function featured(): Promise<Featured | null> {
  try {
    const pick = records(await sql(`
WITH s AS (SELECT source_id, dataset_id, indicator_id, geo FROM observations
  WHERE value IS NOT NULL AND source_id <> 'sec_edgar' AND geo IS NOT NULL
  GROUP BY ALL HAVING count(DISTINCT period_start) >= 3)
SELECT source_id, dataset_id, indicator_id, count(*) AS g FROM s GROUP BY ALL HAVING count(*) >= 2
ORDER BY g DESC, source_id, dataset_id, indicator_id LIMIT 1`))[0];
    if (!pick) return null;
    const where = ["source_id", "dataset_id", "indicator_id"].map((k) => `${k} = ${sqlLiteral(String(pick[k]))}`).join(" AND ");
    const r = await sql(`
SELECT st.*, s.title FROM (${statsSql(where, 120)}) st
LEFT JOIN series s ON s.source_id = st.source_id AND s.dataset_id = st.dataset_id AND s.indicator_id = st.indicator_id
WHERE st.n >= 3 ORDER BY (st.geo IN ('USA','IND','GBR','JPN','BRA','CHN','DEU','FRA')) DESC, st.n DESC, st.geo LIMIT 5`);
    const stats = records(r).map(toStat);
    if (stats.length < 2) return null;
    const byT = new Map<string, Record<string, number | string>>();
    for (const s of stats) for (const p of s.points) byT.set(p.t, { ...(byT.get(p.t) ?? { t: p.t }), [s.geo ?? s.id]: p.v });
    return {
      title: stats[0].title ?? String(pick.indicator_id), unit: unitLabel(stats[0].unit, stats[0].unitMult) || null, freq: stats[0].freq, sourceId: String(pick.source_id),
      geos: stats.map((s) => s.geo ?? s.id), rows: [...byT.values()].sort((a, b) => String(a.t).localeCompare(String(b.t))),
    };
  } catch {
    return null;
  }
}

// The unfiltered list changes only on ingest or config: cache it for 5 minutes (errors are not cached).
export const allSources = unstable_cache(() => sources(), ["sources"], { revalidate: 300 });

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
