"use client";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartData } from "@/lib/chat/chart";
import { mergeRows } from "@/lib/chat/merge";
import { citationLine, formatCompact, formatValue } from "@/lib/format";
import { inWindow, rangeState, type PresetId } from "@/lib/range";
import { RangeControl } from "@/components/SeriesChart";

type Kind = ChartData["type"];
const color = (i: number) => `var(--color-chart-${(i % 5) + 1})`;
const btn = "rounded-xl border border-border px-2.5 py-1 text-xs";
const on = "bg-accent text-accent-foreground";

export function csvOf(data: ChartData): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = mergeRows(data.series);
  const head = ["period", ...data.series.map((s) => q(s.label))].join(",");
  return [head, ...rows.map((r) => [r.period, ...data.series.map((s) => r[s.series_id] ?? "")].join(","))].join("\n");
}

export function ChartCard({ data }: { data: ChartData }) {
  const [kind, setKind] = useState<Kind>(data.type);
  const [selected, setSelected] = useState<PresetId>("Max");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const all = useMemo(() => mergeRows(data.series), [data.series]);
  const periods = useMemo(() => all.map((r) => String(r.period)), [all]);
  const range = useMemo(() => rangeState(periods, selected), [periods, selected]);
  const rows = useMemo(
    () => (range.from === null ? all : all.filter((r) => inWindow(String(r.period), range.from))),
    [all, range.from],
  );

  if (!data.series.length)
    return (
      <div role="alert" className="my-3 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-medium">Could not build the chart &ldquo;{data.title}&rdquo;</p>
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>
    );

  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (!n.delete(id)) n.add(id); return n; });
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csvOf(data)], { type: "text/csv" }));
    a.download = `${data.title.replace(/\W+/g, "-").toLowerCase() || "chart"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const shown = data.series.map((s, i) => ({ s, i })).filter(({ s }) => !hidden.has(s.series_id));
  const axes = (
    <>
      <CartesianGrid stroke="var(--color-border)" vertical={false} />
      <XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={32} tickFormatter={(p: string) => p.slice(0, 7)} />
      <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v: number) => formatCompact(v)} />
      <Tooltip
        formatter={(v, n) => [formatValue(v), data.series.find((s) => s.series_id === n)?.label ?? n]}
        contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }}
      />
    </>
  );
  const c = (i: number) => color(i);
  const chart =
    kind === "bar" ? (
      <BarChart data={rows}>{axes}{shown.map(({ s, i }) => <Bar key={s.series_id} dataKey={s.series_id} fill={c(i)} isAnimationActive={false} />)}</BarChart>
    ) : kind === "area" ? (
      <AreaChart data={rows}>{axes}{shown.map(({ s, i }) => <Area key={s.series_id} dataKey={s.series_id} stroke={c(i)} fill={c(i)} fillOpacity={0.2} connectNulls isAnimationActive={false} />)}</AreaChart>
    ) : (
      <LineChart data={rows}>{axes}{shown.map(({ s, i }) => <Line key={s.series_id} dataKey={s.series_id} stroke={c(i)} strokeWidth={2} dot={rows.length < 40} connectNulls isAnimationActive={false} />)}</LineChart>
    );

  return (
    <figure className="my-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <figcaption className="font-semibold">{data.title}</figcaption>
          {data.unit && <p className="text-xs text-muted-foreground">{data.unit}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["line", "bar", "area"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`${btn} ${kind === k ? on : ""}`}>{k}</button>
          ))}
          <button type="button" onClick={download} className={btn}>CSV</button>
        </div>
      </div>
      <RangeControl periods={periods} state={range} onSelect={setSelected} className="mt-3" />
      <div className="mt-3 h-64 w-full tabular-nums" role="img" aria-label={`${kind} chart: ${data.title}`}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {data.series.map((s, i) => (
          <li key={s.series_id}>
            <button type="button" aria-pressed={!hidden.has(s.series_id)} onClick={() => toggle(s.series_id)} className={`inline-flex items-center gap-1 ${hidden.has(s.series_id) ? "opacity-40 line-through" : ""}`}>
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: color(i) }} />
              {s.label}
            </button>
          </li>
        ))}
      </ul>
      {data.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {data.citations.length > 0 && (
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {data.citations.map((ci, i) => <span key={i} className="mr-2 inline-block">{citationLine(ci)}.</span>)}
        </p>
      )}
    </figure>
  );
}

export function ChartSkeleton({ n }: { n: number }) {
  return (
    <div className="my-3 rounded-xl border border-border bg-card p-4" aria-busy="true">
      <p className="text-sm text-muted-foreground">Fetching {n} series…</p>
      <div className="mt-3 h-48 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
