import { cache } from "react";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { SourceCard } from "@/components/SourceCard";
import { UpdateCard } from "@/components/SeriesCards";
import { SeriesChart } from "@/components/SeriesChart";
import { Skeleton } from "@/components/Skeleton";
import { featured, geoName, geoNames, latestUpdates, newestBySource, orElse, sourceList } from "@/lib/data";
import { shortSourceName } from "@/lib/format";
import { chip, card } from "@/lib/ui";

// Both throw on failure or an empty result (so nothing empty is cached); the sections catch outside the cache.
const cachedUpdates = unstable_cache(() => latestUpdates(40), ["home-updates"], { revalidate: 3600 });
const cachedFeatured = unstable_cache(() => featured(), ["home-featured"], { revalidate: 3600 });
// React cache: sections of one render share a single load.
const pool = cache(() => orElse("latestUpdates", cachedUpdates, []));
const feat = cache(() => orElse("featured", cachedFeatured, null));

const shortMap = (srcs: Awaited<ReturnType<typeof sourceList>>) => new Map(srcs.map((s) => [s.id, shortSourceName(s.name)]));

export const SectionSkeleton = ({ className = "h-64" }: { className?: string }) => <Skeleton className={className} />;

/** "{n} official sources" in the hero; "dozens of" until (or unless) the source list loads. */
export async function SourceCount() {
  const srcs = await sourceList();
  return <>{srcs.length || "dozens of"}</>;
}

export async function LatestUpdates() {
  const [p, srcs, names] = await Promise.all([pool(), sourceList(), geoNames()]);
  const updates = p.slice(0, 6);
  if (!updates.length) return null;
  const short = shortMap(srcs);
  return (
    <section aria-labelledby="latest">
      <h2 id="latest" className="mb-1 text-xl font-semibold tracking-tight">Latest updates</h2>
      <p className="mb-4 text-sm text-muted-foreground">Most recently refreshed series across sources.</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {updates.map((s) => <UpdateCard key={s.id} s={s} source={short.get(s.source_id ?? "") ?? s.source_id ?? ""} geo={geoName(names, s.geo)} names={names} />)}
      </div>
    </section>
  );
}

export async function Featured() {
  const [f, srcs, names] = await Promise.all([feat(), sourceList(), geoNames()]);
  if (!f) return null;
  const short = shortMap(srcs);
  return (
    <section aria-labelledby="feat" className={`${card} p-5`}>
      <h2 id="feat" className="text-xl font-semibold tracking-tight">{f.title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {f.geos.length} countries compared · {short.get(f.sourceId) ?? f.sourceId}{f.unit ? ` · ${f.unit}` : ""}
      </p>
      <SeriesChart rows={f.rows} unit={f.unit} freq={f.freq}
        lines={f.geos.map((g) => ({ key: g, label: geoName(names, g) ?? g }))} />
    </section>
  );
}

export async function SourcesSummary() {
  const [p, srcs, names] = await Promise.all([pool(), sourceList(), geoNames()]);
  const browseable = srcs.filter((s) => s.series > 0).sort((a, b) => b.series - a.series);
  if (!browseable.length) return null;
  const short = shortMap(srcs), sample = newestBySource(p);
  return (
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
  );
}
