import Link from "next/link";
import type { SeriesDetail } from "@/lib/client";
import { freqLabel } from "@/lib/format";
import { geoName } from "@/lib/data";
import { searchHref } from "@/lib/params";
import { card, chip } from "@/lib/ui";

/** Computed insights (with footnote) and quick-filter links into /search. */
export function InsightsSidebar({ lines, n, source, scope, names, d }: {
  lines: string[]; n: number; source: string; scope?: string | null;
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
      <section aria-labelledby="tags" className={`${card} p-5`}>
        <h2 id="tags" className="mb-3 text-sm font-semibold">Find more like this</h2>
        <div className="flex flex-wrap gap-2">{tags.map((t) => <Link key={t.label + t.href} href={t.href} className={chip}>{t.label}</Link>)}</div>
      </section>
    </aside>
  );
}
