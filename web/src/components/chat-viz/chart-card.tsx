"use client";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { groupSeries, type ChartData, type ChartSeries } from "@/lib/chat/chart";
import { mergeRows } from "@/lib/chat/merge";
import { citationLine, formatCompact, formatValue } from "@/lib/format";
import { inWindow, rangeState, type PresetId } from "@/lib/range";
import { RangeControl } from "@/components/SeriesChart";

type Kind = ChartData["type"];
// The theme defines 10 chart colours; an answer has at most 8 series, so no two share one.
const color = (i: number) => `var(--color-chart-${(i % 10) + 1})`;
const btn = "rounded-xl border border-border px-2.5 py-1 text-xs";
const on = "bg-accent text-accent-foreground";

export function csvOf(data: ChartData): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = mergeRows(data.series);
  const head = ["period", ...data.series.map((s) => q(s.unit ? `${s.label} (${s.unit})` : s.label))].join(",");
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
  const panels = groupSeries(data.series);
  const many = panels.length > 1;

  return (
    <figure className="my-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <figcaption className="font-semibold">{data.title}</figcaption>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["line", "bar", "area"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`${btn} ${kind === k ? on : ""}`}>{k}</button>
          ))}
          <button type="button" onClick={download} className={btn}>CSV</button>
        </div>
      </div>
      <RangeControl periods={periods} state={range} onSelect={setSelected} className="mt-3" />
      {panels.map((p, n) => (
        <Panel key={n} series={p} all={data.series} rows={rows} kind={kind} hidden={hidden} toggle={toggle} many={many} fallbackUnit={many ? "" : data.unit} title={data.title} />
      ))}
      {data.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {data.citations.length > 0 && (
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {data.citations.map((ci, i) => <span key={i} className="mr-2 inline-block">{citationLine(ci)}.</span>)}
        </p>
      )}
    </figure>
  );
}

/** One y-axis: a combined chart (several series) or one panel of a small-multiples stack. Colours follow the series' place in the whole answer. */
function Panel({ series, all, rows, kind, hidden, toggle, many, fallbackUnit, title }: {
  series: ChartSeries[]; all: ChartSeries[]; rows: Record<string, string | number>[]; kind: Kind; hidden: Set<string>;
  toggle: (id: string) => void; many: boolean; fallbackUnit: string; title: string;
}) {
  const unit = series[0].unit || fallbackUnit || "unit not reported";
  const c = (s: ChartSeries) => color(all.indexOf(s));
  const shown = series.filter((s) => !hidden.has(s.series_id));
  const axes = (
    <>
      <CartesianGrid stroke="var(--color-border)" vertical={false} />
      <XAxis dataKey="period" tick={{ fontSize: 11 }} minTickGap={32} tickFormatter={(p: string) => p.slice(0, 7)} />
      <YAxis tick={{ fontSize: 11 }} width={72} tickFormatter={(v: number) => formatCompact(v)}
        label={{ value: unit, angle: -90, position: "insideLeft", offset: 4, fontSize: 11, style: { textAnchor: "middle" } }} />
      <Tooltip
        formatter={(v, n) => [formatValue(v), series.find((s) => s.series_id === n)?.label ?? n]}
        contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)", fontSize: 12 }}
      />
    </>
  );
  const chart =
    kind === "bar" ? (
      <BarChart data={rows}>{axes}{shown.map((s) => <Bar key={s.series_id} dataKey={s.series_id} fill={c(s)} isAnimationActive={false} />)}</BarChart>
    ) : kind === "area" ? (
      <AreaChart data={rows}>{axes}{shown.map((s) => <Area key={s.series_id} dataKey={s.series_id} stroke={c(s)} fill={c(s)} fillOpacity={0.2} connectNulls isAnimationActive={false} />)}</AreaChart>
    ) : (
      <LineChart data={rows}>{axes}{shown.map((s) => <Line key={s.series_id} dataKey={s.series_id} stroke={c(s)} strokeWidth={2} dot={rows.length < 40} connectNulls isAnimationActive={false} />)}</LineChart>
    );
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">
        {many && series.map((s) => s.label).join(", ")}
        <span className={`${many ? "ml-2 " : ""}text-xs font-normal text-muted-foreground`}>{unit}</span>
      </p>
      <div className={`${many ? "mt-1 h-40" : "h-64"} w-full tabular-nums`} role="img" aria-label={`${kind} chart: ${many ? series.map((s) => s.label).join(", ") : title}`}>
        <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {series.map((s) => (
          <li key={s.series_id}>
            <button type="button" title={s.series_id} aria-pressed={!hidden.has(s.series_id)} onClick={() => toggle(s.series_id)} className={`inline-flex items-center gap-1 ${hidden.has(s.series_id) ? "opacity-40 line-through" : ""}`}>
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c(s) }} />
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
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
