import { unstable_cache } from "next/cache";
import Link from "next/link";
import { ErrorNote } from "@/components/ErrorNote";
import { SourceCard } from "@/components/SourceCard";
import { SourceFilters } from "@/components/filters/SourceFilters";
import { sources, type SourceStatus } from "@/lib/client";
import { allSources, orElse, geoNames, latestUpdates, newestBySource } from "@/lib/data";
import { filterSources, parseSourceFilters, sourcesApiParams } from "@/lib/params";
import { card, TERMS } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds: the free API host wakes slowly

const cachedUpdates = unstable_cache(() => latestUpdates(40), ["home-updates"], { revalidate: 300 });

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
  const [pool, names] = await Promise.all([orElse("latestUpdates", cachedUpdates, []), geoNames()]);
  const sample = newestBySource(pool);
  const active = Object.values(f).some((v) => (Array.isArray(v) ? v.length : v));
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Sources</h1>
      <p className="mb-6 mt-1 text-muted-foreground">Integrated data providers. Pick one to browse its series.</p>
      <p className="-mt-4 mb-6 text-xs text-muted-foreground">{TERMS}</p>
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
          {rows.map((s) => <SourceCard key={s.id} s={s} sample={sample.get(s.id)} names={names} />)}
        </div>
      )}
    </>
  );
}
