"use client";
import { useMemo, useState } from "react";
import { Brush, CartesianGrid, Legend, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, periodLabel } from "@/lib/format";
import { coverageText, inWindow, rangeState, unavailableReason, type Preset, type PresetId, type RangeState } from "@/lib/range";

export type ChartRow = Record<string, number | string | null>;
const COLORS = Array.from({ length: 10 }, (_, i) => `var(--color-chart-${i + 1})`);

/** Preset buttons plus the muted coverage line. Disabled presets are muted, aria-disabled and not clickable. */
export function RangeControl({ periods, state, onSelect, freq, className = "" }: {
  periods: string[]; state: RangeState; onSelect: (id: PresetId) => void; freq?: string | null; className?: string;
}) {
  const coverage = coverageText(periods, freq);
  return (
    <div className={`flex flex-col items-start gap-1.5 ${className}`}>
      <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-border p-0.5 text-sm">
        {state.presets.map((p: Preset) => {
          const on = p.id === state.active;
          const tone = on ? "bg-accent text-accent-foreground"
            : p.available ? "text-muted-foreground hover:text-foreground" : "cursor-not-allowed text-muted-foreground/40";
          return (
            <button key={p.id} type="button" aria-pressed={on} aria-disabled={p.available ? undefined : true}
              title={p.available ? undefined : unavailableReason(p, periods, freq)}
              onClick={() => { if (p.available) onSelect(p.id); }}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${tone}`}>
              {p.id}
            </button>
          );
        })}
      </div>
      {coverage && <p className="text-xs text-muted-foreground">{coverage}</p>}
    </div>
  );
}

/** Multi-line chart. `rows` are wide: {t: "2020-01-01", IND: 5.1, USA: 4}. `lines` maps key -> display label. */
export function SeriesChart({ rows, lines, unit, freq, presets = false, height = 360, outliers }: {
  rows: ChartRow[]; lines: { key: string; label: string; slot?: number; dashed?: boolean }[]; unit?: string | null; freq?: string | null;
  presets?: boolean; height?: number; outliers?: string[]; // periods of the first line with an unusual change (computed)
}) {
  const [selected, setSelected] = useState<PresetId>("Max");
  const periods = useMemo(() => rows.map((r) => String(r.t)), [rows]);
  const range = useMemo(() => rangeState(periods, selected), [periods, selected]);
  const data = useMemo(
    () => (range.from === null ? rows : rows.filter((r) => inWindow(String(r.t), range.from))),
    [rows, range.from],
  );
  const dots = data.length <= 40;
  const flagged = outliers?.length && lines[0] ? data.flatMap((r) => (outliers.includes(String(r.t)) && typeof r[lines[0].key] === "number" ? [{ t: String(r.t), v: r[lines[0].key] as number }] : [])) : [];

  return (
    <div className="w-full min-w-0">
      {presets && <RangeControl periods={periods} state={range} onSelect={setSelected} freq={freq} className="mb-3" />}
      <div style={{ height }} className="w-full" role="img" aria-label={`Line chart of ${lines.map((l) => l.label).join(", ")}${unit ? ` in ${unit}` : ""}`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" tickFormatter={(t: string) => periodLabel(t, freq)} minTickGap={48} tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }} />
            <YAxis tickFormatter={(v: number) => formatCompact(v)} width={52} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip
              cursor={{ stroke: "var(--color-border)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
                    <div className="mb-1 font-medium">{periodLabel(String(label), freq)}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center gap-2">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
                        <span className="text-muted-foreground">{lines.find((l) => l.key === p.dataKey)?.label}</span>
                        <span className="ml-auto pl-3 font-medium tabular-nums">{typeof p.value === "number" ? p.value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "n/a"}{unit ? ` ${unit}` : ""}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {lines.length > 1 && <Legend iconType="plainline" iconSize={14} wrapperStyle={{ fontSize: 12 }} />}
            {lines.map((l, i) => (
              <Line key={l.key} dataKey={l.key} name={l.label} type="monotone" stroke={l.dashed ? "var(--color-muted-foreground)" : COLORS[(l.slot ?? i) % COLORS.length]} strokeWidth={l.dashed ? 1.5 : 2}
                strokeDasharray={l.dashed ? "5 4" : undefined} dot={dots && !l.dashed ? { r: 2.5 } : false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            ))}
            {flagged.map((o) => (
              <ReferenceDot key={o.t} x={o.t} y={o.v} ifOverflow="discard"
                shape={({ cx, cy }: { cx?: number; cy?: number }) => (
                  <circle cx={cx} cy={cy} r={6} fill="none" stroke="var(--color-chart-3)" strokeWidth={2}><title>{`Unusual change (computed): ${periodLabel(o.t, freq)}`}</title></circle>
                )} />
            ))}
            {data.length > 60 && <Brush dataKey="t" height={24} stroke="var(--color-border)" tickFormatter={(t: string) => periodLabel(t, freq)} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
