import { unitLabel } from "./format";
import type { Pt } from "./data";
import type { ChartRow } from "@/components/SeriesChart";

const MAX_LINES = 5;

/**
 * Turn the /observations table into chart lines: one line per geo (plus dimension values when a series
 * carries several), restricted to the dominant frequency so annual and quarterly points never mix.
 */
export function buildChart(columns: string[], rows: unknown[][], geoLabel: (g: string | null) => string | null) {
  const ix = (c: string) => columns.indexOf(c);
  const [iT, iV, iG, iD, iF, iU, iM] = ["period_start", "value", "geo", "dims", "freq", "unit", "unit_mult"].map(ix);
  const valid = rows.filter((r) => typeof r[iV] === "number" && r[iT]);
  const fcount = new Map<string, number>();
  for (const r of valid) fcount.set(String(r[iF] ?? ""), (fcount.get(String(r[iF] ?? "")) ?? 0) + 1);
  const freq = [...fcount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const use = valid.filter((r) => String(r[iF] ?? "") === freq);
  const combos = new Set(use.map((r) => JSON.stringify(r[iD] ?? {})));
  const lines = new Map<string, Map<string, number>>();
  for (const r of use) {
    const g = iG >= 0 ? (r[iG] as string | null) : null;
    const dims = r[iD] && typeof r[iD] === "object" ? Object.values(r[iD] as object).join(", ") : "";
    const label = `${geoLabel(g) ?? "Series"}${combos.size > 1 && dims ? ` (${dims})` : ""}`;
    if (!lines.has(label)) lines.set(label, new Map());
    lines.get(label)!.set(String(r[iT]), r[iV] as number);
  }
  const ranked = [...lines.entries()].sort((a, b) => b[1].size - a[1].size);
  const shown = ranked.slice(0, MAX_LINES);
  const byT = new Map<string, ChartRow>();
  for (const [label, m] of shown) for (const [t, v] of m) byT.set(t, { ...(byT.get(t) ?? { t }), [label]: v });
  const last = use.at(-1);
  return {
    lines: shown.map(([label, m]) => ({ key: label, label, points: [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]): Pt => ({ t, v })) })),
    rows: [...byT.values()].sort((a, b) => String(a.t).localeCompare(String(b.t))),
    freq: freq || null,
    unit: last && iU >= 0 ? unitLabel(last[iU] as string | null) || null : null,
    unitMult: last && iM >= 0 ? ((last[iM] as number) ?? null) : null,
    dropped: ranked.length - shown.length,
  };
}
