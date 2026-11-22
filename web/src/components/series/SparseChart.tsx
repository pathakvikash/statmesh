"use client";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, periodLabel } from "@/lib/format";
import type { Pt } from "@/lib/data";

/** Bars for the 1-4 stored points of a series (a line needs more). Baseline 0; value on every bar. */
export function SparseChart({ points, freq, unit }: { points: Pt[]; freq?: string | null; unit?: string | null }) {
  const data = points.map((p) => ({ ...p, label: periodLabel(p.t, freq) }));
  if (!data.length) return null;
  return (
    <div role="img" style={{ height: 160 }} className="w-full"
      aria-label={`Bar chart of ${data.length} stored ${data.length === 1 ? "value" : "values"}${unit ? ` in ${unit}` : ""}: ${data.map((p) => `${p.label} ${formatCompact(p.v)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 160 }}>
        <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--color-border)" }} tick={{ fontSize: 12 }} />
          <YAxis width={44} domain={[(m: number) => Math.min(0, m), (m: number) => Math.max(0, m)]} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatCompact(v)} />
          <Tooltip cursor={{ fill: "var(--color-muted)" }} content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as { label: string; v: number } | undefined) : undefined;
            return p ? (
              <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
                <div className="text-muted-foreground">{p.label}</div>
                <div className="font-medium tabular-nums">{p.v.toLocaleString("en-US", { maximumFractionDigits: 4 })}{unit ? ` ${unit}` : ""}</div>
              </div>
            ) : null;
          }} />
          <Bar dataKey="v" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} maxBarSize={72} isAnimationActive={false}>
            <LabelList dataKey="v" content={(p) => {
              const { x = 0, y = 0, width = 0, height = 0, value } = p as { x?: number; y?: number; width?: number; height?: number; value?: number };
              const v = Number(value);
              return <text x={Number(x) + Number(width) / 2} y={v < 0 ? Number(y) + Number(height) + 14 : Number(y) - 5} textAnchor="middle" fontSize={12} fill="var(--color-foreground)">{formatCompact(v)}</text>;
            }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
