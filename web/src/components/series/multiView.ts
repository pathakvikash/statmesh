import { geoLatest, geoName, geoRows, hitStats, type SeriesStat } from "@/lib/data";
import { periodLabel, unitLabel } from "@/lib/format";
import { chartMode, defaultGeos, geoNoun, isRegion, isSubnational, pickHeadline, periodsFromRows, type PeriodStat } from "@/lib/multigeo";

/** Everything the multi-geo header and chart need, from per-geo latest values (+ a few full series, or all rows for <=3 periods). */
export type MultiView = {
  stat: SeriesStat; summary: string; unit: string; freq: string | null; noun: string;
  bars?: { period: string; rows: { geo: string; name: string; v: number }[] };
  candidates?: { geo: string; name: string }[]; initial?: Record<string, { t: string; v: number }[]>;
};
export async function multiView(id: string, ml: NonNullable<Awaited<ReturnType<typeof geoLatest>>>, names: Map<string, string>, sel?: Record<string, string>): Promise<MultiView> {
  const name = (g: string) => geoName(names, g) ?? g;
  const unit = unitLabel(ml.unit, ml.unitMult);
  const few = chartMode(ml.periods) === "bars";
  const noun = geoNoun(isSubnational(ml.rows.filter((r) => !isRegion(r.geo)).map((r) => r.geo)));
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  // Lines mode: the headline, count, median and sparkline come from the same hitStats() query as the search card, never from latest-per-geo rows.
  const hs = few ? undefined : (await hitStats([id]))[id];
  const all = few ? await geoRows(id, ml, undefined, sel).catch(() => []) : ml.rows.map((r) => ({ geo: r.geo, t: r.lp, v: r.v }));
  const periods = periodsFromRows(all);
  const period = pickHeadline(periods.map((p: PeriodStat) => ({ ...p, w: null })))?.period;
  const at = few ? all.filter((r) => r.t === period && !isRegion(r.geo)) : [];
  const [lo, hi] = [Math.min(...at.map((r) => r.v)), Math.max(...at.map((r) => r.v))];
  const top = at.reduce((b, r) => (r.v > b.v ? r : b), at[0]);
  const t0 = hs?.multi?.top[0];
  const summary = at.length ? `Across ${at.length} ${noun} in ${periodLabel(period, ml.freq)}: ${fmt(lo)} to ${fmt(hi)}${unit ? ` ${unit}` : ""}. Highest: ${name(top.geo)} (${fmt(top.v)}).`
    : t0 ? `Highest in the latest well-covered period: ${name(t0.geo)} (${fmt(t0.v)}).` : "";
  const stat: SeriesStat = {
    id, title: null, source_id: null, geo: null, freq: ml.freq, unit: ml.unit, unitMult: ml.unitMult, start: "", end: "", retrieved: ml.retrieved, n: ml.periods,
    points: hs?.points ?? [], multi: hs?.multi ?? { geos: at.length, sub: noun !== "countries", headline: pickHeadline(periods), spark: "bars", top: [] },
  };
  const base = { stat, summary, unit, freq: ml.freq, noun };
  if (few) return { ...base, bars: { period: periodLabel(period, ml.freq), rows: at.map((r) => ({ geo: r.geo, name: name(r.geo), v: r.v })) } };
  const geos = defaultGeos(ml.rows);
  const rows = await geoRows(id, ml, geos, sel).catch(() => []);
  const initial: Record<string, { t: string; v: number }[]> = Object.fromEntries(geos.map((g) => [g, []]));
  for (const r of rows) initial[r.geo]?.push({ t: r.t, v: r.v });
  const candidates = ml.rows.filter((r) => !r.geo.startsWith("unmapped:")).map((r) => ({ geo: r.geo, name: name(r.geo) })).sort((a, b) => (a.geo === "region:WLD" ? -1 : b.geo === "region:WLD" ? 1 : a.name.localeCompare(b.name)));
  return { ...base, candidates, initial: Object.fromEntries(Object.entries(initial).filter(([, p]) => p.length)) };
}
