import Link from "next/link";
import { Sparkline } from "@/components/Sparkline";
import type { SeriesDetail, SeriesHit } from "@/lib/client";
import type { SeriesStat } from "@/lib/data";
import { formatCompact, freqLabel, periodLabel, seriesHref, unitLabel } from "@/lib/format";
import { geoName } from "@/lib/data";
import { searchHref } from "@/lib/params";
import { card, chip } from "@/lib/ui";

/** Computed insights (with footnote), related series with their latest value, and quick-filter links into /search. */
export function InsightsSidebar({ lines, n, source, scope, related, stats, names, d }: {
  lines: string[]; n: number; source: string; scope?: string | null; related: SeriesHit[]; stats: Record<string, SeriesStat>;
  names: Map<string, string>; d: SeriesDetail;
}) {
  const tags: { label: string; href: string }[] = [
    ...d.topics.map((t) => ({ label: t, href: searchHref({ topic: t }) })),
    ...(d.geo ? [{ label: geoName(names, d.geo) ?? d.geo, href: searchHref({ geo: d.geo }) }] : []),
    ...(d.freq ? [{ label: freqLabel(d.freq) ?? d.freq, href: searchHref({ freq: d.freq }) }] : []),
    { label: d.source_id, href: `/sources/${encodeURIComponent(d.source_id)}` },
  ];
  return (
    <aside className="space-y-6">
      {lines.length > 0 && (
        <section aria-labelledby="ins" className={`${card} p-5`}>
          <h2 id="ins" className="mb-3 text-sm font-semibold">Computed insights</h2>
          <ul className="list-disc space-y-2 pl-4 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="mt-3 text-xs text-muted-foreground">Calculated from {n} stored observations{scope ? ` (line: ${scope})` : ""}. Source: {source}.</p>
        </section>
      )}
      {related.length > 0 && (
        <section aria-labelledby="rel" className={`${card} p-5`}>
          <h2 id="rel" className="mb-3 text-sm font-semibold">Related series</h2>
          <ul className="space-y-3 text-sm">
            {related.map((h) => {
              const s = stats[h.series_id], last = s?.points.at(-1);
              return (
                <li key={h.series_id}>
                  <Link href={seriesHref(h.series_id)} className="font-medium hover:text-accent hover:underline">{h.title}</Link>
                  <div className="text-xs text-muted-foreground">{[h.source_id, geoName(names, h.geo), freqLabel(h.freq)].filter(Boolean).join(" · ")}</div>
                  {s && last && (
                    <div className="mt-1 flex items-center gap-3">
                      <div className="text-xs tabular-nums"><span className="font-medium">{formatCompact(last.v)}</span> {unitLabel(s.unit, s.unitMult)} <span className="text-muted-foreground">{periodLabel(last.t, s.freq)}</span></div>
                      <div className="w-20"><Sparkline points={s.points} freq={s.freq} unit={s.unit} height={28} /></div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section aria-labelledby="tags" className={`${card} p-5`}>
        <h2 id="tags" className="mb-3 text-sm font-semibold">Find more like this</h2>
        <div className="flex flex-wrap gap-2">{tags.map((t) => <Link key={t.label + t.href} href={t.href} className={chip}>{t.label}</Link>)}</div>
      </section>
    </aside>
  );
}
