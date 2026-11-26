import type { Citation } from "../format";
import { buildChart, expandConstants } from "../obs";
import { collectEvidence } from "./evidence";
import type { ChatEvent } from "./events";
import { MAX_POINTS, type ChartData, type ChartSeries } from "./chart";

export const AUTO_MIN_PERIODS = 3;
const MAX_SERIES = 8;
type Rec = Record<string, unknown>;

/**
 * Chart for answers where the model did not call show_chart: built only from get_observations results
 * already in the conversation (time series of >= 3 periods, one line per country). Null for single
 * values, text-only answers, or when the model drew a chart itself.
 */
export function autoChart(events: ChatEvent[]): ChartData | null {
  if (events.some((e) => e.t === "call" && e.name === "show_chart")) return null;
  const meta = collectEvidence(events).meta;
  const byKey = new Map<string, ChartSeries>();
  const citations: Citation[] = [];
  const warnings: string[] = [];
  const seenCit = new Set<string>();
  for (const e of events) {
    if (e.t !== "result" || e.name !== "get_observations") continue;
    const o = e.output as Rec | null;
    if (!o || o.status !== "ok" || !Array.isArray(o.columns) || !Array.isArray(o.rows) || typeof o.series_id !== "string") continue;
    const id = o.series_id;
    const x = expandConstants(o.columns as string[], o.rows as unknown[][], o.constants as Rec | undefined);
    const built = buildChart(x.columns, x.rows, (g) => g);
    const lines = built.lines.filter((l) => l.points.length >= AUTO_MIN_PERIODS);
    if (!lines.length) continue;
    const title = meta.get(id)?.title || id;
    for (const l of lines) {
      const key = `${id}|${l.key}`;
      const pts = new Map(byKey.get(key)?.points.map((p) => [p.period, p.value]));
      for (const p of l.points) pts.set(p.t, p.v);
      const points = [...pts].sort((a, b) => a[0].localeCompare(b[0])).map(([period, value]) => ({ period, value })).slice(-MAX_POINTS);
      const old = byKey.get(key);
      if (old) { old.points = points; continue; }
      // A lone line keeps the bare id unless another call (e.g. a different geo) already took it.
      const many = lines.length > 1 || [...byKey.values()].some((s) => s.series_id === id);
      byKey.set(key, { series_id: many ? key : id, label: many ? `${title}: ${l.label}` : title, unit: l.unit ?? undefined, freq: built.freq ?? undefined, points });
    }
    if (built.dropped) warnings.push(`${title}: showing ${lines.length} of ${lines.length + built.dropped} lines`);
    if (o.partial) warnings.push(`${title}: dataset is partial (a row cap cut the data)`);
    else if (o.truncated) warnings.push(`${title}: more rows than the chart shows`);
    for (const c of (Array.isArray(o.citations) ? o.citations : []) as Citation[]) {
      const k = `${c.source_id}|${c.dataset_id}|${c.series_id ?? ""}`;
      if (!seenCit.has(k)) (seenCit.add(k), citations.push(c));
    }
  }
  const series = [...byKey.values()];
  if (!series.length) return null;
  const used = series.slice(0, MAX_SERIES);
  if (used.length < series.length) warnings.push(`Showing ${used.length} of ${series.length} series`);
  const units = new Set(used.map((s) => s.unit ?? ""));
  const names = [...new Set(used.map((s) => s.label))];
  return {
    title: names.length > 2 ? `${names[0]}, ${names[1]} and ${names.length - 2} more` : names.join(" and "),
    type: "line",
    unit: units.size === 1 ? [...units][0] : "",
    series: used,
    citations,
    warnings,
  };
}
