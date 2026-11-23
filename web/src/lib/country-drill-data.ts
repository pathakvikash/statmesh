// Server-only loader for the country drill. Every literal goes through sqlLiteral; every query is bounded.
import { describe, relatedSeries, sql } from "./client";
import { geoName, geoNames, geoLatest, seriesShape } from "./data";
import { SEXES, citeLine, drillSelection, pickRelated, relatedBase, rankOf, sexOfCode, sexSplit, type Candidate, type Sex } from "./country-drill";
import { unitLabel } from "./format";
import { dimsSql, geoNoun, isRegion, isSubnational } from "./multigeo";
import { sqlLiteral } from "./sql";

type Pt = { t: string; v: number };
export type DrillRelated = { id: string; title: string; kind: "split" | "title"; unit: string; freq: string | null; points: Pt[]; source: string };
export type DrillData = {
  geo: string; name: string; sex: Sex;
  split: Sex[] | null; // sexes stored on this series (null: no male/female split stored)
  unit: string; freq: string | null; points: Pt[]; // the country's values for the chosen sex (empty: none stored)
  rank: { rank: number; of: number; noun: string } | null;
  related: DrillRelated[]; // Male/Female only
  source: string;
};

const records = (r: { columns: string[]; rows: unknown[][] }) =>
  r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) as Record<string, unknown>[];
const K3 = "regexp_extract(series_id, '^([^:]+:[^:]+:[^:]+)', 1)";
const MAX_POINTS = 200;

/** One country's points: dominant frequency, the chosen dimension values (or the dominant combination), one value per period. */
async function countryPoints(seriesId: string, sel?: Record<string, string>): Promise<{ points: Pt[]; freq: string | null; unit: string }> {
  const where = (s?: Record<string, string>) => `series_id = ${sqlLiteral(seriesId)} AND value IS NOT NULL${s && Object.keys(s).length ? ` AND ${dimsSql(s)}` : ""}`;
  const run = async (s?: Record<string, string>) => records(await sql(`
WITH raw AS (SELECT period_start, freq, CAST(dims AS VARCHAR) AS dk, value, retrieved_at, unit, unit_mult FROM observations WHERE ${where(s)}),
f AS (SELECT freq FROM raw GROUP BY freq ORDER BY count(*) DESC, freq LIMIT 1),
d AS (SELECT dk FROM raw WHERE freq IS NOT DISTINCT FROM (SELECT freq FROM f) GROUP BY dk ORDER BY count(*) DESC, dk LIMIT 1)
SELECT CAST(period_start AS VARCHAR) AS t, arg_max(value, retrieved_at) AS v, any_value(freq) AS freq, any_value(unit) AS unit, any_value(unit_mult) AS um FROM raw
WHERE freq IS NOT DISTINCT FROM (SELECT freq FROM f) AND dk IS NOT DISTINCT FROM (SELECT dk FROM d) GROUP BY period_start ORDER BY period_start LIMIT 1000`));
  const r = await run(sel);
  const rows = r.slice(-MAX_POINTS);
  return {
    points: rows.map((x) => ({ t: String(x.t), v: Number(x.v) })).filter((p) => Number.isFinite(p.v)),
    freq: (rows.at(-1)?.freq as string) ?? null,
    unit: unitLabel(rows.at(-1)?.unit as string | null, rows.at(-1)?.um as number | null),
  };
}

// Words that make a title a candidate for one sex; the final judgement is pickRelated's (it also drops the other sex).
const WORDS: Record<"male" | "female", string[]> = {
  female: ["women", "woman", "female", "girl", "maternal", "pregnan", "fertility", "birth rate", "antenatal", "contracept", "family planning"],
  male: ["male", " men", "(men", "boys", "adult mortality", "life expectancy", "suicide", "road traffic", "alcohol", "tobacco"],
};

/** Everything the drill shows for one country and sex. `dims`: the page's dim.* selection. */
export async function loadDrill(key: string, geo: string, sex: Sex, dims: Record<string, string>): Promise<DrillData> {
  const names = await geoNames();
  const [shape, parent] = await Promise.all([seriesShape(key), describe(key).catch(() => null)]);
  const split = sexSplit(shape?.dims);
  const stored = split ? SEXES.filter((s) => split.codes[s]) : null;
  const { sel, noData } = drillSelection(dims, split, sex);
  const rankSel = Object.keys(sel).length ? sel : undefined;
  const [main, peers] = await Promise.all([
    noData ? Promise.resolve({ points: [] as Pt[], freq: null, unit: "" }) : countryPoints(`${key}:${geo}`, rankSel),
    noData ? Promise.resolve(null) : geoLatest(key, rankSel),
  ]);
  const countries = (peers?.rows ?? []).filter((r) => !isRegion(r.geo));
  const rk = rankOf(countries, geo);
  const c = parent?.citation;
  return {
    geo, name: geoName(names, geo) ?? geo, sex, split: stored,
    unit: main.unit || unitLabel(parent?.unit), freq: main.freq, points: main.points,
    rank: rk ? { ...rk, noun: geoNoun(isSubnational(countries.map((r) => r.geo)), countries.length) } : null,
    related: sex === "all" ? [] : await loadRelated(key, geo, sex, parent?.source_id ?? key.split(":")[0]),
    source: c ? citeLine(c) : key,
  };
}

async function loadRelated(key: string, geo: string, sex: Exclude<Sex, "all">, source: string): Promise<DrillRelated[]> {
  const like = WORDS[sex].map((w) => `lower(title) LIKE ${sqlLiteral(`%${w}%`)}`).join(" OR ");
  const [withSplit, byTitle, rel] = await Promise.all([
    // Series that store a sex split for this country (so the country certainly has rows), with the sexes stored.
    sql(`SELECT o.k, s.title, o.dk, o.sx FROM (SELECT k, any_value(dk) AS dk, list(DISTINCT sx) AS sx FROM
           (SELECT ${K3} AS k, list_filter(map_keys(dims), x -> lower(x) IN ('sex', 'gender'))[1] AS dk,
                   CAST(element_at(dims, list_filter(map_keys(dims), x -> lower(x) IN ('sex', 'gender'))[1])[1] AS VARCHAR) AS sx
            FROM observations WHERE geo = ${sqlLiteral(geo)} AND source_id = ${sqlLiteral(source)}) WHERE dk IS NOT NULL GROUP BY k) o
         JOIN series s ON s.series_key = o.k LIMIT 120`).then(records).catch(() => []),
    sql(`SELECT series_key AS k, title FROM series WHERE source_id = ${sqlLiteral(source)} AND (${like}) LIMIT 150`).then(records).catch(() => []),
    relatedSeries(key, { geo, limit: 12 }).then((r) => r.hits).catch(() => []),
  ]);
  const codes = new Map<string, { dim: string; code: string }>(); // series key -> sex dim key as stored, and the code of the wanted sex
  const cands = new Map<string, Candidate>();
  for (const r of withSplit) {
    const sx = (Array.isArray(r.sx) ? r.sx : []).map(String);
    const k = String(r.k);
    const hit = sx.find((x) => sexOfCode(x) === sex);
    if (hit) codes.set(k, { dim: String(r.dk), code: hit });
    cands.set(k, { id: k, title: String(r.title), sexes: sx.flatMap((x) => sexOfCode(x) ?? []) });
  }
  for (const r of byTitle) if (!cands.has(String(r.k))) cands.set(String(r.k), { id: String(r.k), title: String(r.title) });
  for (const h of rel) { const id = relatedBase(h.series_id); if (!cands.has(id)) cands.set(id, { id, title: h.title }); }
  cands.delete(key);
  const picks = pickRelated(sex, [...cands.values()], 10);
  const got = await Promise.all(picks.map(async (p): Promise<DrillRelated | null> => {
    const sx = p.sex === "title" ? undefined : codes.get(p.id);
    const [r, d] = await Promise.all([countryPoints(`${p.id}:${geo}`, sx ? { [sx.dim]: sx.code } : undefined).catch(() => null), describe(p.id).catch(() => null)]);
    // Rule 7: no citation, no card.
    return r && r.points.length && d?.citation ? { id: p.id, title: p.title, kind: p.sex === "title" ? "title" : "split", unit: r.unit, freq: r.freq, points: r.points, source: citeLine(d.citation) } : null;
  }));
  return got.filter((x): x is DrillRelated => !!x).slice(0, 5);
}
