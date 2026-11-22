// Pure statistics over one series' points. Everything here is computed from the stored observations, never written by a model.
import type { Pt } from "./data";
import { isRegion } from "./multigeo";
import { periodLabel } from "./format";

export type Insights = {
  n: number; latest: Pt; prev?: Pt; abs?: number; pct?: number; // pct omitted when prev = 0
  min: Pt; max: Pt; first: Pt; cagr: number | null;
};

const YEAR_MS = 365.25 * 86_400_000;
const RATE_UNIT = /%|‰|percent|per cent|\brate\b|\bpts?\b|\bpp\b|\bbps\b|basis point|ratio/i;

/** Compound annual growth, only for a span of at least a year, all-positive values and a level (not percent/rate) unit. */
export function cagr(points: Pt[], unit?: string | null): number | null {
  if (points.length < 2 || !unit || RATE_UNIT.test(unit)) return null;
  if (points.some((p) => !(p.v > 0))) return null;
  const a = points[0], b = points[points.length - 1];
  const years = (Date.parse(b.t) - Date.parse(a.t)) / YEAR_MS;
  if (!(years >= 1 - 1e-2) || Number.isNaN(years)) return null;
  return (b.v / a.v) ** (1 / years) - 1;
}

/** Points must be chronological. Null for no points. Min/max ties resolve to the earliest period. */
export function computeInsights(points: Pt[], unit?: string | null): Insights | null {
  if (!points.length) return null;
  const latest = points[points.length - 1], prev = points.length > 1 ? points[points.length - 2] : undefined;
  let min = points[0], max = points[0];
  for (const p of points) { if (p.v < min.v) min = p; if (p.v > max.v) max = p; }
  const abs = prev ? latest.v - prev.v : undefined;
  return { n: points.length, latest, prev, abs, pct: prev && prev.v !== 0 ? (abs! / Math.abs(prev.v)) * 100 : undefined, min, max, first: points[0], cagr: cagr(points, unit) };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Periods whose change from the previous period is unusual (robust z of changes, median/MAD, |z| > 3.5). Null when n < 12. */
export function outliers(points: Pt[]): string[] | null {
  if (points.length < 12) return null;
  const ch = points.slice(1).map((p, i) => p.v - points[i].v);
  const m = median(ch), mad = median(ch.map((c) => Math.abs(c - m)));
  if (mad === 0) return [];
  return points.slice(1).filter((_, i) => Math.abs((0.6745 * (ch[i] - m)) / mad) > 3.5).map((p) => p.t);
}

/** Rank (1 = highest) of `geo` among countries (regions excluded) and the country count. Null when geo is absent. */
export function rankAmong(rows: { geo: string; v: number }[], geo?: string | null): { rank: number; n: number } | null {
  if (!geo) return null;
  const c = rows.filter((r) => !isRegion(r.geo));
  const me = c.find((r) => r.geo === geo);
  if (!me) return null;
  if (c.length < 2) return null; // a rank among one is not a rank
  return { rank: 1 + c.filter((r) => r.v > me.v).length, n: c.length };
}

const f = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Plain sentences, each labelled computed. Empty with fewer than 2 points. */
export function insightLines(ins: Insights | null, freq?: string | null, unit?: string | null, unusual?: string[] | null): string[] {
  if (!ins || ins.n < 2) return [];
  const p = (t: string) => periodLabel(t, freq), u = unit ? ` ${unit}` : "";
  const out: string[] = [];
  if (ins.prev && ins.abs !== undefined) {
    const dir = ins.abs > 0 ? "rose" : ins.abs < 0 ? "fell" : "was unchanged";
    out.push(`From ${p(ins.prev.t)} to ${p(ins.latest.t)} the value ${dir}${ins.abs !== 0 ? ` by ${f(Math.abs(ins.abs))}${u}${ins.pct !== undefined ? ` (${f(Math.abs(ins.pct))}%)` : ""}` : ""} (computed).`);
  }
  out.push(`Highest ${f(ins.max.v)}${u} in ${p(ins.max.t)}; lowest ${f(ins.min.v)}${u} in ${p(ins.min.t)} (computed).`);
  if (ins.cagr !== null) out.push(`Compound annual growth from ${p(ins.first.t)} to ${p(ins.latest.t)}: ${f(ins.cagr * 100)}% a year (computed).`);
  if (unusual?.length) out.push(`${unusual.length} unusual period-to-period ${unusual.length === 1 ? "change" : "changes"}: ${unusual.map(p).join(", ")} (computed).`);
  return out;
}
