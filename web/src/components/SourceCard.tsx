import Link from "next/link";
import { AskAiButton } from "./AskAiButton";
import { Badge, MiniBars, askOnCard, stretch } from "./SeriesCards";
import { Sparkline } from "./Sparkline";
import type { SourceStatus } from "@/lib/client";
import type { SeriesStat } from "@/lib/data";
import { REDIST_LABELS, kindLabel, relativeTime, shortSourceName, unitLabel } from "@/lib/format";
import { card } from "@/lib/ui";

export const keyState = (s: SourceStatus) => (s.auth === "none" ? "No key needed" : s.key_configured ? "API key set" : "API key missing");

/** Source card for home and /sources. Whole card links to /sources/<id>; the sample chart fills the right side. */
export function SourceCard({ s, sample, names = new Map(), compact = false }: { s: SourceStatus; sample?: SeriesStat; names?: Map<string, string>; compact?: boolean }) {
  const name = shortSourceName(s.name);
  const chart = sample?.multi?.spark === "bars" ? <MiniBars bars={sample.multi.top} names={names} unit={unitLabel(sample.unit, sample.unitMult)} />
    : sample && sample.points.length >= 2 ? <Sparkline points={sample.points} freq={sample.freq} unit={unitLabel(sample.unit, sample.unitMult)} height={56} /> : null;
  return (
    <article className={`${card} group relative flex flex-col gap-3 p-5 transition-shadow hover:shadow-md ${s.enabled ? "" : "opacity-60"}`}>
      <div className="pr-16">
        <h2 className="truncate font-semibold"><Link href={`/sources/${encodeURIComponent(s.id)}`} className={`hover:text-accent hover:underline ${stretch}`}>{name}</Link></h2>
        <p className="line-clamp-2 text-xs text-muted-foreground">{s.name}</p>
      </div>
      {s.topics && s.topics.length > 0 && !compact && <div className="flex flex-wrap gap-1.5">{s.topics.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      <div className="text-2xl font-semibold tabular-nums">{s.series.toLocaleString()}
        <span className="ml-1.5 text-sm font-normal text-muted-foreground">series · {s.datasets} datasets</span></div>
      {chart ? (
        <div className="min-w-0"><div className="line-clamp-1 text-xs text-muted-foreground">e.g. {sample!.title ?? sample!.id}</div>{chart}</div>
      ) : (
        <p className="text-xs text-muted-foreground">{s.series.toLocaleString()} series across {s.datasets} datasets</p>
      )}
      <ul className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <li>{kindLabel(s.kind)}</li>
        <li>{keyState(s)}</li>
        <li>{REDIST_LABELS[s.redistribute] ?? s.redistribute}</li>
        <li>{s.last_ingested_at ? `Updated ${relativeTime(s.last_ingested_at)}` : "Never ingested"}</li>
        {!s.enabled && <li className="font-medium">Disabled</li>}
        {s.stale_datasets > 0 && <li className="font-medium text-chart-3">{s.stale_datasets} stale</li>}
      </ul>
      <AskAiButton target={{ kind: "source", id: s.id, name: s.name }} className={`absolute right-3 top-3 ${askOnCard}`} />
    </article>
  );
}
