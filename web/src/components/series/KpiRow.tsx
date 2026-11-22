import { InfoTip } from "./InfoTip";
import { Sparkline } from "@/components/Sparkline";
import type { Pt } from "@/lib/data";
import { periodLabel, unitLabel } from "@/lib/format";
import { card } from "@/lib/ui";
import type { Insights } from "@/lib/insights";

const f = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

function Kpi({ id, title, info, children }: { id: string; title: string; info: string; children: React.ReactNode }) {
  return (
    <div className={`${card} min-w-0 space-y-1 p-4`}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{title}</span><InfoTip id={id} text={info} />
      </div>
      {children}
    </div>
  );
}

/** Four KPI cards computed from the loaded points. With one period only Latest shows, plus a note. `source` is the citation footnote. */
export function KpiRow({ ins, points, freq, unit, mult, rank, source, label }: {
  ins: Insights; points: Pt[]; freq?: string | null; unit?: string | null; mult?: number | null;
  rank: { rank: number; n: number; noun: string } | null; source: string; label?: string | null; // label: which line, when the chart has several
}) {
  const scope = label ? ` (line: ${label})` : "";
  const p = (t: string) => periodLabel(t, freq), u = unitLabel(unit, mult);
  const unitEl = u && <span className="ml-1 text-sm font-normal text-muted-foreground">{u}</span>;
  const latest = (
    <Kpi id="kpi-latest" title="Latest" info="The value of the most recent period ingested for this series, as stored. Nothing is estimated.">
      <div className="text-2xl font-semibold tabular-nums">{f(ins.latest.v)}{unitEl}</div>
      <div className="text-xs text-muted-foreground">{p(ins.latest.t)}{label ? ` · ${label}` : ""}</div>
      {points.length > 1 && <Sparkline points={points} freq={freq} unit={u} height={40} />}
    </Kpi>
  );
  if (ins.n < 2) {
    return (
      <section aria-label="Key figures" className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{latest}</div>
        <p className="text-xs text-muted-foreground">Only one period ingested ({p(ins.latest.t)}). Change, range and trend need 2+ periods.</p>
        <p className="text-xs text-muted-foreground">Source: {source}.</p>
      </section>
    );
  }
  const up = (ins.abs ?? 0) > 0, down = (ins.abs ?? 0) < 0;
  const fourth = ins.cagr !== null
    ? { id: "kpi-cagr", title: "CAGR", info: `Compound annual growth rate: (latest / first)^(1 / years) - 1, from ${p(ins.first.t)} to ${p(ins.latest.t)}. Shown only for spans of a year or more with all values above zero and a level (non-percent) unit.`,
        body: <><div className="text-2xl font-semibold tabular-nums">{f(ins.cagr * 100)}%</div><div className="text-xs text-muted-foreground">per year, {p(ins.first.t)} to {p(ins.latest.t)}</div></> }
    : rank ? { id: "kpi-rank", title: "Rank", info: `Position of this series' latest value among all ${rank.noun} in the same series family (regions excluded), highest first. Latest period can differ by ${rank.noun === "countries" ? "country" : "place"}.`,
        body: <><div className="text-2xl font-semibold tabular-nums">#{rank.rank}<span className="ml-1 text-sm font-normal text-muted-foreground">of {rank.n}</span></div><div className="text-xs text-muted-foreground">among {rank.noun}, highest first</div></> }
    : { id: "kpi-cov", title: "Coverage", info: "The number of periods stored for this series and the first and last period among them.",
        body: <><div className="text-2xl font-semibold tabular-nums">{ins.n}<span className="ml-1 text-sm font-normal text-muted-foreground">periods</span></div><div className="text-xs text-muted-foreground">{p(ins.first.t)} to {p(ins.latest.t)}</div></> };
  return (
    <section aria-label="Key figures" className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {latest}
        <Kpi id="kpi-change" title="Change vs previous" info="Latest value minus the previous period's value. The percentage is that difference divided by the absolute previous value, and is left out when the previous value is zero.">
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-medium tabular-nums ${up ? "bg-accent/10 text-accent" : down ? "bg-chart-3/10" : "bg-muted"}`}>
            {up ? "▲" : down ? "▼" : "•"} {f(Math.abs(ins.abs ?? 0))}{ins.pct !== undefined ? ` (${f(Math.abs(ins.pct))}%)` : ""}
          </span>
          <div className="text-xs text-muted-foreground">{p(ins.prev!.t)} to {p(ins.latest.t)}</div>
        </Kpi>
        <Kpi id="kpi-range" title="Range" info="The lowest and highest value among all stored periods, with the period each occurred in. Ties show the earliest period.">
          <div className="text-sm tabular-nums"><span className="text-muted-foreground">Max </span>{f(ins.max.v)} <span className="text-xs text-muted-foreground">{p(ins.max.t)}</span></div>
          <div className="text-sm tabular-nums"><span className="text-muted-foreground">Min </span>{f(ins.min.v)} <span className="text-xs text-muted-foreground">{p(ins.min.t)}</span></div>
        </Kpi>
        <Kpi id={fourth.id} title={fourth.title} info={fourth.info}>{fourth.body}</Kpi>
      </div>
      <p className="text-xs text-muted-foreground">Computed from {ins.n} stored observations{scope}. Source: {source}.</p>
    </section>
  );
}
