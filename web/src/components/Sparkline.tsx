"use client";
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { formatCompact, periodLabel } from "@/lib/format";
import type { Pt } from "@/lib/data";

/** Small interactive area chart; hover shows period and value. */
export function Sparkline({ points, freq, unit, height = 56, color = "var(--color-chart-1)" }: {
  points: Pt[]; freq?: string | null; unit?: string | null; height?: number; color?: string;
}) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (points.length < 2) return null;
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`Trend of ${points.length} observations`}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 160, height }}>
        <AreaChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "var(--color-border)" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as Pt | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-sm">
                  <div className="text-muted-foreground">{periodLabel(p.t, freq)}</div>
                  <div className="font-medium tabular-nums">{formatCompact(p.v)}{unit ? ` ${unit}` : ""}</div>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${gid})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
