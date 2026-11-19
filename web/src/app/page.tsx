import { unstable_cache } from "next/cache";
import Link from "next/link";
import { ErrorNote } from "@/components/ErrorNote";
import { Filters } from "@/components/Filters";
import { ResultCard, UpdateCard } from "@/components/SeriesCards";
import { SearchForm } from "@/components/SearchForm";
import { SeriesChart } from "@/components/SeriesChart";
import { EmptyState, type Removal } from "@/components/filters/EmptyState";
import type { SeriesHit } from "@/lib/client";
import { featured, findSeries, geoName, geoNames, hitStats, latestUpdates, sourceList, type SeriesStat } from "@/lib/data";
import { freqLabel, shortSourceName } from "@/lib/format";
import { LICENCE_OPTIONS, TOPICS, filtersHref, hasFilters, parseFilters, understandQuery, updatedPreset, without, type ChipKey, type Filters as FilterState } from "@/lib/params";
import { card, chip } from "@/lib/ui";

export const dynamic = "force-dynamic";
// The two full scans behind the home page change only when ingestion runs: cache them for 5 minutes.
const cachedUpdates = unstable_cache(() => latestUpdates(6), ["home-updates"], { revalidate: 300 });
const cachedFeatured = unstable_cache(() => featured(), ["home-featured"], { revalidate: 300 });
type P = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const EXAMPLES = ["unemployment rate India", "CPI inflation", "policy rate", "GDP", "exports to USA", "population"];
const href = (p: Record<string, string | undefined>) => {
  const u = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  return u.size ? `/?${u}` : "/";
};

export default async function Page({ searchParams }: P) {
  const f = parseFilters(await searchParams);
  return f.q || hasFilters(f) ? <Results f={f} /> : <Home />;
}

async function Home() {
  const [updates, feat, srcs, names] = await Promise.all([cachedUpdates(), cachedFeatured(), sourceList(), geoNames()]);
  const short = new Map(srcs.map((s) => [s.id, shortSourceName(s.name)]));
  const browseable = srcs.filter((s) => s.series > 0).sort((a, b) => b.series - a.series);
  return (
    <div className="space-y-14">
      <section className="mx-auto max-w-3xl pt-6 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Ask anything about the world&rsquo;s statistics</h1>
        <p className="mt-3 text-muted-foreground">Describe the data you need in plain words. We search {srcs.length || "dozens of"} official sources and cite every number.</p>
        <div className="mt-6 text-left"><SearchForm big /></div>
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Example questions">
          {EXAMPLES.map((e) => <Link key={e} href={href({ q: e })} className={chip}>{e}</Link>)}
        </div>
      </section>

      {updates.length > 0 && (
        <section aria-labelledby="latest">
          <h2 id="latest" className="mb-1 text-xl font-semibold tracking-tight">Latest updates</h2>
          <p className="mb-4 text-sm text-muted-foreground">Most recently refreshed series across sources.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {browseable.slice(0, 8).map((s) => (
              <Link key={s.id} href={href({ source: s.id })} className={`${card} p-4 transition-shadow hover:shadow-md`}>
                <div className="font-medium">{short.get(s.id)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.series.toLocaleString()} series · {s.datasets} datasets</div>
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {browseable.slice(8).map((s) => <Link key={s.id} href={href({ source: s.id })} className={chip}>{short.get(s.id)} <span className="text-muted-foreground">{s.series}</span></Link>)}
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
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

async function Results({ f }: { f: FilterState }) {
  const q = f.q;
  const [srcs, names] = await Promise.all([sourceList(), geoNames()]);
  const short = new Map(srcs.map((s) => [s.id, shortSourceName(s.name)]));
  let hits: SeriesHit[] = [], error: unknown;
  try {
    hits = await findSeries(f);
  } catch (e) {
    error = e;
  }
  const stats: Record<string, SeriesStat> = await hitStats(hits.map((h) => h.series_id));
  const chips: { k: ChipKey; v?: string; label: string }[] = [
    ...(f.geo ? [{ k: "geo" as const, label: geoName(names, f.geo) ?? f.geo }] : []),
    ...(f.freq ? [{ k: "freq" as const, label: freqLabel(f.freq) ?? f.freq }] : []),
    ...f.source.map((v) => ({ k: "source" as const, v, label: short.get(v) ?? v })),
    ...f.topic.map((v) => ({ k: "topic" as const, v, label: v })),
    ...(f.start_year ? [{ k: "start_year" as const, label: `From ${f.start_year}` }] : []),
    ...(f.end_year ? [{ k: "end_year" as const, label: `To ${f.end_year}` }] : []),
    ...(f.updated_since ? [{ k: "updated_since" as const, label: { "30d": "Updated in the last 30 days", "1y": "Updated in the last year" }[updatedPreset(f.updated_since)] ?? `Updated since ${f.updated_since}` }] : []),
    ...(f.redistribute ? [{ k: "redistribute" as const, label: LICENCE_OPTIONS.find((o) => o.value === f.redistribute)?.label ?? f.redistribute }] : []),
  ];
  const geoOptions = [...names].map(([code, name]) => ({ code, name }));
  const srcOptions = srcs.filter((s) => s.series > 0).sort((a, b) => b.series - a.series)
    .map((s) => ({ id: s.id, name: shortSourceName(s.name), series: s.series }));

  let removals: Removal[] = [], topicHints: string[] = [];
  if (!error && hits.length === 0) {
    // Result count if each filter were dropped (one cheap search each, at most 3).
    removals = await Promise.all(chips.slice(0, 3).map(async (c) => {
      const g = without(f, c.k, c.v);
      const count = await findSeries(g).then((r) => r.length).catch(() => undefined);
      return { label: c.label, href: filtersHref(g), count };
    }));
    // Topics come from the API's own classification of what the bare query finds.
    const found = f.q ? await findSeries({ q: f.q, source: [], topic: [] }).catch(() => []) : [];
    const n = new Map<string, number>();
    for (const h of found) for (const t of h.topics ?? []) n.set(t, (n.get(t) ?? 0) + 1);
    topicHints = [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 4);
    if (!topicHints.length) topicHints = TOPICS.slice(0, 4);
  }

  return (
    <div className="space-y-6">
      <SearchForm q={q} filters={{ ...f, q: undefined }} />
      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <Filters geos={geoOptions} sources={srcOptions} />
        <section aria-labelledby="res" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h1 id="res" className="mr-2 text-lg font-semibold tracking-tight">
              {error ? "Search unavailable" : `${hits.length >= 25 ? "Top 25" : hits.length} result${hits.length === 1 ? "" : "s"}${q ? ` for “${q}”` : ""}`}
            </h1>
            {chips.map((c) => (
              <Link key={`${c.k}=${c.v ?? ""}`} href={filtersHref(without(f, c.k, c.v))} aria-label={`Remove filter ${c.label}`} className={chip}>
                {c.label} <span aria-hidden className="text-muted-foreground">×</span>
              </Link>
            ))}
            {chips.length > 0 && <Link href={filtersHref({ q, source: [], topic: [] })} className="text-sm text-accent hover:underline">Clear all</Link>}
          </div>
          {error ? <ErrorNote error={error} /> : hits.length === 0 ? (
            <EmptyState f={f} understood={understandQuery(q, names)} removals={removals} topics={topicHints} examples={EXAMPLES} srcs={srcs} />
          ) : (
            <div className="space-y-3">
              {hits.map((h) => (
                <ResultCard key={h.series_id} h={h} stat={stats[h.series_id]} source={short.get(h.source_id) ?? h.source_id} geo={geoName(names, h.geo)} names={names} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
