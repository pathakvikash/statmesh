import Link from "next/link";
import { ErrorNote } from "@/components/ErrorNote";
import { Badge } from "@/components/SeriesCards";
import { SourceFilters } from "@/components/filters/SourceFilters";
import { sources, type SourceStatus } from "@/lib/client";
import { allSources } from "@/lib/data";
import { REDIST_LABELS, kindLabel, relativeTime, shortSourceName } from "@/lib/format";
import { filterSources, parseSourceFilters, sourcesApiParams } from "@/lib/params";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

const keyState = (s: SourceStatus) => (s.auth === "none" ? "No key needed" : s.key_configured ? "API key set" : "API key missing");

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseSourceFilters(await searchParams);
  let all: SourceStatus[], rows: SourceStatus[];
  try {
    // The API filters by q/topic/etc.; the unfiltered list (cached) gives the "N of M" total.
    const [a, matched] = await Promise.all([allSources(), sources(sourcesApiParams(f))]);
    all = [...a].sort((x, y) => y.series - x.series || x.name.localeCompare(y.name));
    // q and topic were applied by the API; the rest of the groups (multi-value, key state) are finished here.
    rows = filterSources([...matched].sort((x, y) => y.series - x.series || x.name.localeCompare(y.name)), { ...f, q: "", topic: [] });
  } catch (e) {
    return <ErrorNote error={e} />;
  }
  const active = Object.values(f).some((v) => (Array.isArray(v) ? v.length : v));
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Sources</h1>
      <p className="mb-6 mt-1 text-muted-foreground">Integrated data providers. Pick one to browse its series.</p>
      <SourceFilters f={f} kinds={[...new Set(all.map((s) => s.kind))].sort()} showTopics={all.some((s) => s.topics)} />
      <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
        {rows.length} of {all.length} sources{active && <> · <Link href="/sources" className="text-accent hover:underline">Clear filters</Link></>}
      </p>
      {rows.length === 0 ? (
        <div className={`${card} p-6`}>
          <p className="font-medium">No sources match.</p>
          <p className="mt-1 text-sm text-muted-foreground">Try fewer filters, or <Link href="/sources" className="text-accent hover:underline">clear them all</Link>.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <Link key={s.id} href={`/?source=${encodeURIComponent(s.id)}`}
              className={`${card} flex flex-col gap-3 p-5 transition-shadow hover:shadow-md ${s.enabled ? "" : "opacity-60"}`}>
              <div>
                <h2 className="font-semibold">{shortSourceName(s.name)}</h2>
                <p className="line-clamp-2 text-xs text-muted-foreground">{s.name}</p>
              </div>
              {s.topics && s.topics.length > 0 && <div className="flex flex-wrap gap-1.5">{s.topics.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
              <div className="text-2xl font-semibold tabular-nums">{s.series.toLocaleString()}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">series · {s.datasets} datasets</span></div>
              <ul className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <li>{kindLabel(s.kind)}</li>
                <li>{keyState(s)}</li>
                <li>{REDIST_LABELS[s.redistribute] ?? s.redistribute}</li>
                <li>{s.last_ingested_at ? `Updated ${relativeTime(s.last_ingested_at)}` : "Never ingested"}</li>
                {!s.enabled && <li className="font-medium">Disabled</li>}
                {s.stale_datasets > 0 && <li className="font-medium text-chart-3">{s.stale_datasets} stale</li>}
              </ul>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
