import { unstable_cache } from "next/cache";
import Link from "next/link";
import { SourceCard } from "@/components/SourceCard";
import { UpdateCard } from "@/components/SeriesCards";
import { CoreIndicators } from "@/components/CoreIndicators";
import { SearchForm } from "@/components/SearchForm";
import { SeriesChart } from "@/components/SeriesChart";
import { redirect } from "next/navigation";
import { featured, orElse, geoName, geoNames, latestUpdates, newestBySource, sourceList } from "@/lib/data";
import { shortSourceName } from "@/lib/format";
import { EXAMPLES, filtersHref, hasFilters, parseFilters, searchHref } from "@/lib/params";
import { card, chip } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds: the free API host wakes slowly and the stats queries take a few seconds
// Both throw on failure or an empty result (so nothing empty is cached); Home() catches outside the cache.
const cachedUpdates = unstable_cache(() => latestUpdates(40), ["home-updates"], { revalidate: 300 });
const cachedFeatured = unstable_cache(() => featured(), ["home-featured"], { revalidate: 300 });
type P = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Page({ searchParams }: P) {
  const f = parseFilters(await searchParams);
  // Old links (/?q=, /?source=) keep working: search lives at /search now, with every filter carried over.
  if (f.q || hasFilters(f)) redirect(filtersHref(f));
  return <Home />;
}

async function Home() {
  const [pool, feat, srcs, names] = await Promise.all([orElse("latestUpdates", cachedUpdates, []), orElse("featured", cachedFeatured, null), sourceList(), geoNames()]);
  const updates = pool.slice(0, 6);
  const sample = newestBySource(pool);
  const short = new Map(srcs.map((s) => [s.id, shortSourceName(s.name)]));
  const browseable = srcs.filter((s) => s.series > 0).sort((a, b) => b.series - a.series);
  return (
    <div className="space-y-14">
      <section className="mx-auto max-w-3xl pt-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ask anything about the world&rsquo;s statistics</h1>
        <p className="mt-3 text-muted-foreground">Describe the data you need in plain words. We search {srcs.length || "dozens of"} official sources and cite every number.</p>
        <div className="mt-6 text-left"><SearchForm big /></div>
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Example questions">
          {EXAMPLES.map((e) => <Link key={e} href={searchHref({ q: e })} className={chip}>{e}</Link>)}
        </div>
      </section>

      <CoreIndicators />

      {updates.length > 0 && (
        <section aria-labelledby="latest">
          <h2 id="latest" className="mb-1 text-xl font-semibold tracking-tight">Latest updates</h2>
          <p className="mb-4 text-sm text-muted-foreground">Most recently refreshed series across sources.</p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {updates.map((s) => <UpdateCard key={s.id} s={s} source={short.get(s.source_id ?? "") ?? s.source_id ?? ""} geo={geoName(names, s.geo)} names={names} />)}
          </div>
        </section>
      )}

      {feat && (
        <section aria-labelledby="feat" className={`${card} p-5`}>
          <h2 id="feat" className="text-xl font-semibold tracking-tight">{feat.title}</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {feat.geos.length} countries compared · {short.get(feat.sourceId) ?? feat.sourceId}{feat.unit ? ` · ${feat.unit}` : ""}
          </p>
          <SeriesChart rows={feat.rows} unit={feat.unit} freq={feat.freq}
            lines={feat.geos.map((g) => ({ key: g, label: geoName(names, g) ?? g }))} />
        </section>
      )}

      {browseable.length > 0 && (
        <section aria-labelledby="src">
          <div className="mb-4 flex items-end justify-between">
            <h2 id="src" className="text-xl font-semibold tracking-tight">Browse by source</h2>
            <Link href="/sources" className="text-sm text-accent hover:underline">All sources</Link>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {browseable.slice(0, 8).map((s) => <SourceCard key={s.id} s={s} sample={sample.get(s.id)} names={names} compact />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {browseable.slice(8).map((s) => <Link key={s.id} href={`/sources/${encodeURIComponent(s.id)}`} className={chip}>{short.get(s.id)} <span className="text-muted-foreground">{s.series}</span></Link>)}
          </div>
        </section>
      )}

      <section className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Link href="/sql" className={`${card} p-4 transition-shadow hover:shadow-md`}>
          <div className="font-medium">SQL console</div>
          <div className="text-sm text-muted-foreground">Query every observation directly with read-only SQL.</div>
        </Link>
        <Link href="/chat" className={`${card} p-4 transition-shadow hover:shadow-md`}>
          <div className="font-medium">Ask the AI with your own key</div>
          <div className="text-sm text-muted-foreground">Chat over the data with cited answers and charts.</div>
        </Link>
      </section>
    </div>
  );
}
