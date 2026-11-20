import { z } from "zod";
import type { Citation } from "../format";
import { buildChart } from "../obs";
import { coverageGap } from "../range";

export const MAX_POINTS = 2000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const showChartInput = z.object({
  title: z.string().min(1),
  type: z.enum(["line", "bar", "area"]),
  series: z.array(z.object({ series_id: z.string().min(1), label: z.string().optional() })).min(1).max(8),
  start: date.optional(),
  end: date.optional(),
  y_label: z.string().optional(),
});
export type ShowChartInput = z.infer<typeof showChartInput>;

export type ChartSeries = { series_id: string; label: string; points: { period: string; value: number }[] };
export type ChartData = {
  title: string;
  type: ShowChartInput["type"];
  unit: string;
  series: ChartSeries[];
  citations: Citation[];
  warnings: string[];
};

/** The slice of lib/client.ts observations() that we use; injected so tests need no network. */
export type ObsFetcher = (
  id: string,
  o: { start?: string; end?: string; signal?: AbortSignal },
) => Promise<{ status: string; columns: string[]; rows: unknown[][]; truncated?: boolean; partial?: boolean; citations?: Citation[] }>;

/** Fetches the numbers server-side so the model never supplies them. Fails soft per series. */
export async function executeShowChart(input: ShowChartInput, fetchObs: ObsFetcher, signal?: AbortSignal): Promise<ChartData> {
  const warnings: string[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  const units = new Set<string>();
  const ids = new Set<string>();
  const wanted = input.series.filter((s) => !ids.has(s.series_id) && ids.add(s.series_id));
  const out = await Promise.all(
    wanted.map(async (s): Promise<ChartSeries | null> => {
      try {
        const r = await fetchObs(s.series_id, { start: input.start, end: input.end, signal });
        if (r.status !== "ok") return (warnings.push(`${s.series_id}: ${r.status}`), null);
        // Dominant freq, one line per dims combination; keep the longest line.
        const built = buildChart(r.columns, r.rows, () => null);
        const line = built.lines[0];
        if (!line) return (warnings.push(`${s.series_id}: no numeric observations`), null);
        if (built.lines.length + built.dropped > 1)
          warnings.push(`${s.series_id}: several dimension combinations; showing "${line.label}" (most points)`);
        const pts = line.points.map((p) => ({ period: p.t, value: p.v }));
        if (pts.length > MAX_POINTS) warnings.push(`${s.series_id}: showing the latest ${MAX_POINTS} of ${pts.length} points`);
        if (r.partial) warnings.push(`${s.series_id}: dataset is partial (a row cap cut the data)`);
        else if (r.truncated) warnings.push(`${s.series_id}: more rows than the chart shows`);
        if (built.unit) units.add(built.unit);
        for (const c of r.citations ?? []) {
          const k = `${c.source_id}|${c.dataset_id}|${c.series_id ?? ""}`;
          if (!seen.has(k)) (seen.add(k), citations.push(c));
        }
        return { series_id: s.series_id, label: s.label ?? s.series_id, points: pts.slice(-MAX_POINTS) };
      } catch (e) {
        warnings.push(`${s.series_id}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }),
  );
  const series = out.filter((s): s is ChartSeries => s !== null);
  // Per series: one series covering the asked range must not hide another that does not.
  const gaps = series.flatMap((s) => {
    const g = coverageGap(input, s.points.map((p) => p.period));
    return g ? [series.length > 1 ? `${s.label}: ${g}` : g] : [];
  });
  warnings.unshift(...gaps);
  if (units.size > 1) warnings.push(`Series use different units (${[...units].join("; ")}); compare shapes, not levels.`);
  return {
    title: input.title,
    type: input.type,
    unit: input.y_label ?? [...units].join(" / "),
    series,
    citations,
    warnings,
  };
}

/** What the model sees instead of every point: enough numbers to quote, none of the bulk. */
export function summarizeChart(d: ChartData) {
  return {
    title: d.title,
    unit: d.unit,
    series: d.series.map((s) => {
      const first = s.points[0], last = s.points[s.points.length - 1];
      return {
        series_id: s.series_id, label: s.label, points: s.points.length,
        first_period: first.period, first_value: first.value, last_period: last.period, last_value: last.value,
      };
    }),
    warnings: d.warnings,
  };
}
