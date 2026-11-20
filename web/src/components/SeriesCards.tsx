import Link from "next/link";
import { Sparkline } from "./Sparkline";
import type { SeriesStat } from "@/lib/data";
import type { SeriesHit } from "@/lib/client";
import { coverageYears, formatCompact, freqLabel, periodLabel, relativeTime, seriesHref, unitLabel } from "@/lib/format";
import { geoNoun, headlineLabel } from "@/lib/multigeo";
import { card } from "@/lib/ui";

export const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{children}</span>
);

type Names = Map<string, string>;
const nameOf = (names: Names) => (g: string) => names.get(g) ?? g;

/** Latest value + change vs previous period. Multi-geo stats lead with a labelled World / median / country headline. */
export function Latest({ s, size = "sm", names = new Map() }: { s: SeriesStat; size?: "sm" | "lg"; names?: Names }) {
  const h = s.multi?.headline;
  const last = h ? { t: h.period, v: h.value } : s.points.at(-1);
  // Multi-geo: "vs prev" only from a series of the same kind as the headline (World with World, median with median).
  const prev = s.multi ? (h && s.multi.spark === (h.kind === "world" ? "world" : "median") && s.points.at(-1)?.t === h.period ? s.points.at(-2) : undefined) : s.points.at(-2);
  if (!last) return null;
  const d = prev ? last.v - prev.v : null;
  const unit = unitLabel(s.unit, s.unitMult);
  const label = h ? headlineLabel(h, nameOf(names), s.multi?.sub) : null;
  return (
    <div>
      <div className={`${size === "lg" ? "text-4xl" : "text-xl"} font-semibold tracking-tight tabular-nums`}>
        {last.v.toLocaleString("en-US", { maximumFractionDigits: 3 })}
        {unit && <span className={`${size === "lg" ? "text-base" : "text-xs"} ml-1.5 font-normal text-muted-foreground`}>{unit}</span>}
      </div>
      <div className="text-xs text-muted-foreground">
        {label && <span className="font-medium text-foreground">{h?.kind === "median" && h.count > 1 ? "Median of " : ""}{label}{" · "}</span>}
        {periodLabel(last.t, s.freq)}
        {d !== null && (
          <span className="ml-2 tabular-nums">
            {d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(d).toLocaleString("en-US", { maximumFractionDigits: 3 })} vs {periodLabel(prev!.t, s.freq)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Tiny horizontal bars of the top countries in the latest period (series with one period, so no trend line). */
export function MiniBars({ bars, names, unit }: { bars: { geo: string; v: number }[]; names: Names; unit?: string }) {
  const max = Math.max(...bars.map((b) => Math.abs(b.v)), 1e-9);
  return (
    <ul className="space-y-1" aria-label="Top countries in the latest period">
      {bars.map((b) => (
        <li key={b.geo} className="flex items-center gap-2 text-xs" title={`${names.get(b.geo) ?? b.geo}: ${b.v.toLocaleString("en-US", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`}>
          <span className="w-20 shrink-0 truncate text-muted-foreground">{names.get(b.geo) ?? b.geo}</span>
          <span className="h-2 rounded-sm bg-chart-1" style={{ width: `${Math.max(2, (Math.abs(b.v) / max) * 100)}%`, maxWidth: "calc(100% - 6.5rem)" }} />
          <span className="tabular-nums">{formatCompact(b.v)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A trend line needs two points; one-period series show the value only, and multi-geo ones show their top countries. */
const Trend = ({ s, names, height }: { s: SeriesStat; names: Names; height: number }) =>
  s.multi?.spark === "bars" ? <MiniBars bars={s.multi.top} names={names} unit={unitLabel(s.unit, s.unitMult)} />
    : s.points.length < 2 ? null
    : <Sparkline points={s.points} freq={s.freq} unit={unitLabel(s.unit, s.unitMult)} height={height} />;

const geoText = (s: SeriesStat | undefined, geo: string | null, names: Names) =>
  s?.multi ? (s.multi.soleGeo ? names.get(s.multi.soleGeo) ?? s.multi.soleGeo : `${s.multi.geos} ${geoNoun(s.multi.sub, s.multi.geos)}`) : geo;

/** Home "Latest updates" card. */
export function UpdateCard({ s, source, geo, names = new Map() }: { s: SeriesStat; source: string; geo: string | null; names?: Names }) {
  geo = geoText(s, geo, names);
  return (
    <article className={`${card} flex flex-col gap-3 p-4 transition-shadow hover:shadow-md`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge>{source}</Badge>
        {geo && <span>{geo}</span>}
        <span className="ml-auto">{relativeTime(s.retrieved)}</span>
      </div>
      <h3 className="line-clamp-2 min-h-10 text-sm font-medium leading-5">
        <Link href={seriesHref(s.id)} className="hover:text-accent hover:underline">{s.title ?? s.id}</Link>
      </h3>
      <Latest s={s} names={names} />
      <Trend s={s} names={names} height={64} />
    </article>
  );
}

/** Search result card. `stat` is absent for series that are not ingested yet. */
export function ResultCard({ h, stat, source, geo, names = new Map() }: { h: SeriesHit; stat?: SeriesStat; source: string; geo: string | null; names?: Names }) {
  const freq = freqLabel(stat?.freq ?? h.freq);
  const years = stat ? coverageYears(stat.start, stat.end) : coverageYears(h.start, h.end);
  const meta = [geoText(stat, geo, names) ?? "Multiple geographies", freq, unitLabel(stat?.unit ?? h.unit, stat?.unitMult)].filter(Boolean);
  return (
    <article className={`${card} p-4 transition-shadow hover:shadow-md`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2"><Badge>{source}</Badge>
            {h.topics?.map((t) => <span key={t} className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">{t}</span>)}
            <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span></div>
          <h3 className="text-base font-medium leading-snug">
            <Link href={seriesHref(h.series_id)} className="hover:text-accent hover:underline">{h.title}</Link>
          </h3>
        </div>
        {stat && (stat.points.length > 0 || stat.multi) ? (
          <div className="w-full shrink-0 sm:w-48">
            <Latest s={stat} names={names} />
            <Trend s={stat} names={names} height={44} />
          </div>
        ) : (
          <p className="shrink-0 text-xs text-muted-foreground sm:w-48" title="Not in this instance's database yet. Open the series for the reason and the command to load it.">
            Not loaded yet
          </p>
        )}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        {years && <span>Coverage {years}</span>}
        {stat?.retrieved && <span>Updated {relativeTime(stat.retrieved)}</span>}
        <span>Licence {h.licence_name}</span>
      </p>
    </article>
  );
}
