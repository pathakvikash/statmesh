import Link from "next/link";
import { Badge } from "@/components/SeriesCards";
import { CopyButton } from "@/components/CopyButton";
import type { SeriesDetail, SourceStatus } from "@/lib/client";
import { citationLine, kindLabel, safeHref, REDIST_LABELS, relativeTime, type Citation } from "@/lib/format";
import { card, TERMS } from "@/lib/ui";

/** Where the numbers come from: source, dataset, licence and citation. The badge reflects only the stored redistribution flag. */
export function Provenance({ d, c, source, coverage, snippet, citation, freq, unit, geo }: {
  d: SeriesDetail; c: Citation; source?: SourceStatus; coverage: string; snippet: string; citation: string;
  freq?: string | null; unit?: string | null; geo?: string | null;
}) {
  const lic = safeHref(c.licence_url), src = safeHref(c.source_url);
  const rows: [string, React.ReactNode][] = [
    ["Source", <Link key="s" className="text-accent hover:underline" href={`/sources/${encodeURIComponent(d.source_id)}`}>{c.source_name}</Link>],
    ["Frequency", freq || "n/a"],
    ["Unit", unit || "n/a"],
    ["Coverage", coverage || "n/a"],
    ["Geography", geo || "n/a"],
    ["Licence", lic ? <a key="l" className="text-accent hover:underline" href={lic}>{c.licence_name}</a> : c.licence_name],
    ["Last updated at source", d.last_updated ?? "n/a"],
  ];
  const tech: [string, React.ReactNode][] = [
    ["Series ID", <code key="i" className="break-all font-mono text-xs">{d.series_id}</code>],
    ["Dataset ID", <code key="d" className="break-all font-mono text-xs">{c.dataset_id}</code>],
    ["Source ID", <code key="si" className="break-all font-mono text-xs">{d.source_id}</code>],
    ["Vintage", c.vintage ?? "n/a"],
    ["Citation retrieved", c.retrieved_at ? c.retrieved_at.slice(0, 16).replace("T", " ") : "n/a"],
    ["Last ingested", relativeTime(d.last_ingested_at) || "n/a"],
  ];
  return (
    <section aria-labelledby="meta" className={`${card} p-5`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 id="meta" className="text-sm font-semibold">Provenance</h2>
        <Badge>{REDIST_LABELS[d.redistribute] ?? d.redistribute}</Badge>
        {source && <Badge>{kindLabel(source.kind)}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>))}
      </dl>
      <details className="mt-4 border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium">Advanced details</summary>
        <p className="mt-2 text-xs text-muted-foreground">{TERMS}</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          {tech.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>))}
        </dl>
        <dl className="mt-3 space-y-3">
          {source?.description && <div><dt className="text-muted-foreground">Source description</dt><dd>{source.description}</dd></div>}
          {c.source_url && <div><dt className="text-muted-foreground">Source URL</dt><dd>{src ? <a className="break-all text-accent hover:underline" href={src}>{c.source_url}</a> : <span className="break-all">{c.source_url}</span>}</dd></div>}
          <div><dt className="text-muted-foreground">Licence URL</dt><dd>{lic ? <a className="break-all text-accent hover:underline" href={lic}>{c.licence_url}</a> : <span className="break-all">{c.licence_url}</span>}</dd></div>
          <div><dt className="text-muted-foreground">Citation</dt><dd className="flex flex-wrap items-start gap-2"><span className="min-w-0 flex-1">{citation || citationLine(c)}</span><CopyButton text={citation} label="Copy" /></dd></div>
          <div><dt className="text-muted-foreground">SQL</dt><dd><pre className="overflow-x-auto rounded-lg border border-border bg-muted p-2 font-mono text-xs">{snippet}</pre></dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">No methodology notes are stored for this series.</p>
      </details>
    </section>
  );
}
