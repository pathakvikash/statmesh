"use client";
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, periodLabel } from "@/lib/format";

export type ChartRow = Record<string, number | string | null>;
const COLORS = Array.from({ length: 10 }, (_, i) => `var(--color-chart-${i + 1})`);
const PRESETS = [{ label: "1Y", years: 1 }, { label: "5Y", years: 5 }, { label: "10Y", years: 10 }, { label: "Max", years: 0 }];

/** Multi-line chart. `rows` are wide: {t: "2020-01-01", IND: 5.1, USA: 4}. `lines` maps key -> display label. */
export function SeriesChart({ rows, lines, unit, freq, presets = false, height = 360 }: {
  rows: ChartRow[]; lines: { key: string; label: string; slot?: number }[]; unit?: string | null; freq?: string | null;
  presets?: boolean; height?: number;
}) {
  const [years, setYears] = useState(0);
  const data = useMemo(() => {
    if (!years || !rows.length) return rows;
    const last = new Date(String(rows[rows.length - 1].t));
    last.setFullYear(last.getFullYear() - years);
    const cut = last.toISOString().slice(0, 10);
    return rows.filter((r) => String(r.t) > cut) // exclusive: "1Y" of annual data is 1 point;
  }, [rows, years]);
  const dots = data.length <= 40;

  return (
    <div className="w-full min-w-0">
      {presets && (
        <div role="group" aria-label="Time range" className="mb-3 inline-flex rounded-lg border border-border p-0.5 text-sm">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" aria-pressed={years === p.years} onClick={() => setYears(p.years)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${years === p.years ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {p.label}
            </button>
          ))}
        </div>
      )}
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
              <Line key={l.key} dataKey={l.key} name={l.label} type="monotone" stroke={COLORS[(l.slot ?? i) % COLORS.length]} strokeWidth={2}
                dot={dots ? { r: 2.5 } : false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
