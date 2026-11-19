import Link from "next/link";
import type { SourceStatus } from "@/lib/client";
import { filtersHref, type Filters, type Understood } from "@/lib/params";
import { shortSourceName } from "@/lib/format";
import { card, chip } from "@/lib/ui";

export type Removal = { label: string; href: string; count?: number };

/** No-results state that teaches: what we understood, what to loosen, where to go next. */
export function EmptyState({ f, understood, removals, topics, examples, srcs }: {
  f: Filters; understood: Understood; removals: Removal[]; topics: string[]; examples: string[]; srcs: SourceStatus[];
}) {
  const notLoaded = srcs.filter((s) => s.enabled && (s.series === 0 || !s.last_ingested_at));
  return (
    <div className={`${card} space-y-5 p-6`}>
      <p className="font-medium">Nothing matched{f.q ? ` “${f.q}”` : ""}.</p>
      {f.q && (
        <div className="text-sm">
          <p className="mb-1.5 text-muted-foreground">We searched for</p>
          <div className="flex flex-wrap items-center gap-2">
            {understood.terms.length ? understood.terms.map((t) => <span key={t} className={`${chip} hover:bg-card`}>{t}</span>) : <span className="text-muted-foreground">no keywords</span>}
            {understood.geo && <span className="text-muted-foreground">in <strong className="font-medium text-foreground">{understood.geo.name}</strong>
              {f.geo !== understood.geo.code && <> · <Link href={filtersHref({ ...f, q: f.q, geo: understood.geo.code })} className="text-accent hover:underline">filter by this country</Link></>}</span>}
          </div>
        </div>
      )}
      {removals.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {removals.map((r) => (
            <li key={r.label}>Remove <Link href={r.href} className="text-accent hover:underline">{r.label}</Link>
              {r.count !== undefined && <> to see {r.count >= 25 ? "25+" : r.count} result{r.count === 1 ? "" : "s"}</>}.</li>
          ))}
        </ul>
      )}
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Browse a topic</p>
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => <Link key={t} href={filtersHref({ ...f, topic: [t] })} className={chip}>{t}</Link>)}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Or try one of these</p>
        <div className="flex flex-wrap gap-2">{examples.map((e) => <Link key={e} href={filtersHref({ q: e, source: [], topic: [] })} className={chip}>{e}</Link>)}</div>
      </div>
      {notLoaded.length > 0 && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Some sources are catalogued but not loaded: run <code className="font-mono text-foreground">statmesh ingest &lt;source&gt;</code>.
          {" "}Not loaded yet: {notLoaded.map((s) => shortSourceName(s.name)).join(", ")}.
        </p>
      )}
      <Link href={`/chat?q=${encodeURIComponent(f.q)}`} className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">
        Ask in Chat
      </Link>
    </div>
  );
}
