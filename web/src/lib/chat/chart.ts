import { z } from "zod";
import type { Citation } from "../format";
import { unitLabel } from "../format";
import { buildChart, expandConstants } from "../obs";
import { coverageGap } from "../range";

export const MAX_POINTS = 2000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const showChartInput = z.object({
  title: z.string().min(1),
  type: z.enum(["line", "bar", "area"]),
  series: z.array(z.object({ series_id: z.string().min(1), label: z.string().nullish() })).min(1).max(8),
  // nullish: the claude CLI path sends null for what it skips, and MCP validates before our code runs
  start: date.nullish(),
  end: date.nullish(),
  y_label: z.string().nullish(),
});
export type ShowChartInput = {
  title: string;
  type: "line" | "bar" | "area";
  series: { series_id: string; label?: string }[];
  start?: string;
  end?: string;
  y_label?: string;
};
/** Turns the nulls the schema accepts into "not given". */
export const cleanChartInput = (i: z.infer<typeof showChartInput>): ShowChartInput => ({
  ...i,
  start: i.start ?? undefined,
  end: i.end ?? undefined,
  y_label: i.y_label ?? undefined,
  series: i.series.map((s) => ({ series_id: s.series_id, label: s.label ?? undefined })),
});

export type ChartSeries = { series_id: string; label: string; unit?: string; freq?: string; points: { period: string; value: number }[] };
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
) => Promise<{ status: string; columns: string[]; rows: unknown[][]; constants?: Record<string, unknown>; truncated?: boolean; partial?: boolean; citations?: Citation[] }>;

/** Fetches the numbers server-side so the model never supplies them. Fails soft per series. */
export async function executeShowChart(input: ShowChartInput, fetchObs: ObsFetcher, signal?: AbortSignal): Promise<ChartData> {
  const warnings: string[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  const units = new Set<string>();
  const ids = new Set<string>();
  const wanted = input.series.filter((s) => !ids.has(s.series_id) && ids.add(s.series_id));
  // Notes are for people: the series' title, not its raw id.
  const name = (s: { series_id: string; label?: string }) => s.label ?? s.series_id;
  const out = await Promise.all(
    wanted.map(async (s): Promise<ChartSeries | null> => {
      try {
        const r = await fetchObs(s.series_id, { start: input.start, end: input.end, signal });
        if (r.status !== "ok") return (warnings.push(`${name(s)}: ${r.status}`), null);
        // Dominant freq, one line per dims combination; keep the longest line.
        const x = expandConstants(r.columns, r.rows, r.constants);
        const built = buildChart(x.columns, x.rows, () => null);
        const line = built.lines[0];
        if (!line) return (warnings.push(`${name(s)}: no numeric observations`), null);
        if (built.lines.length + built.dropped > 1)
          warnings.push(`${name(s)}: several dimension combinations; showing "${line.label}" (most points)`);
        const pts = line.points.map((p) => ({ period: p.t, value: p.v }));
        if (pts.length > MAX_POINTS) warnings.push(`${name(s)}: showing the latest ${MAX_POINTS} of ${pts.length} points`);
        if (r.partial) warnings.push(`${name(s)}: dataset is partial (a row cap cut the data)`);
        else if (r.truncated) warnings.push(`${name(s)}: more rows than the chart shows`);
        if (line.unit) units.add(line.unit);
        for (const c of r.citations ?? []) {
          const k = `${c.source_id}|${c.dataset_id}|${c.series_id ?? ""}`;
          if (!seen.has(k)) (seen.add(k), citations.push(c));
        }
        return { series_id: s.series_id, label: name(s), unit: line.unit ?? undefined, freq: built.freq ?? undefined, points: pts.slice(-MAX_POINTS) };
      } catch (e) {
        warnings.push(`${name(s)}: ${e instanceof Error ? e.message : String(e)}`);
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

/** One y-axis only when it stays readable: same unit and max |value| within this factor of each other. */
export const SCALE_RATIO = 50;
const maxAbs = (s: ChartSeries) => s.points.reduce((m, p) => (Number.isFinite(p.value) ? Math.max(m, Math.abs(p.value)) : m), 0);

/** Splits series into panels: same unit and similar magnitude share one; anything else gets its own axis. Order follows first appearance. */
export function groupSeries(series: ChartSeries[]): ChartSeries[][] {
  // Same unit (aliases folded) and frequency share a panel; an unknown unit never joins anything.
  const byUnit = new Map<string, ChartSeries[]>();
  for (const s of series) {
    const u = unitLabel(s.unit);
    const k = u ? `${u}|${s.freq ?? ""}` : `?|${s.series_id}`;
    byUnit.set(k, [...(byUnit.get(k) ?? []), s]);
  }
  const panels: { big: number; items: ChartSeries[] }[] = [];
  for (const items of byUnit.values()) {
    const open: { big: number; items: ChartSeries[] }[] = [];
    for (const s of [...items].sort((a, b) => maxAbs(b) - maxAbs(a))) {
      const m = maxAbs(s);
      const home = open.find((g) => m === 0 || g.big / m <= SCALE_RATIO);
      if (home) home.items.push(s);
      else open.push({ big: m, items: [s] });
    }
    panels.push(...open);
  }
  const at = (s: ChartSeries) => series.indexOf(s);
  for (const g of panels) g.items.sort((a, b) => at(a) - at(b));
  return panels.sort((a, b) => at(a.items[0]) - at(b.items[0])).map((g) => g.items);
}
