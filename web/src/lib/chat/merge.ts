// Kept apart from chart.ts so client code can merge rows without pulling zod into the bundle.
import type { ChartSeries } from "./chart";

/** Merge series into one row per period (sorted), keyed by series_id, for Recharts. Mixed frequencies leave gaps. */
export function mergeRows(series: ChartSeries[]): Record<string, string | number>[] {
  const by = new Map<string, Record<string, string | number>>();
  for (const s of series)
    for (const p of s.points) {
      const row = by.get(p.period) ?? { period: p.period };
      row[s.series_id] = p.value;
      by.set(p.period, row);
    }
  return [...by.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}
