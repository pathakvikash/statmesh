import { Suspense } from "react";
import Link from "next/link";
import { CoreIndicators } from "@/components/CoreIndicators";
import { ErrorNote } from "@/components/ErrorNote";
import { Filters } from "@/components/Filters";
import { ResultCard } from "@/components/SeriesCards";
import { SearchForm } from "@/components/SearchForm";
import { EmptyState, type Removal } from "@/components/filters/EmptyState";
import type { SeriesHit } from "@/lib/client";
import { findSeries, geoName, geoNames, hitStats, sourceList, type SeriesStat } from "@/lib/data";
import { freqLabel, shortSourceName } from "@/lib/format";
import { EXAMPLES, LICENCE_OPTIONS, TOPICS, filtersHref, hasFilters, parseFilters, searchHref, understandQuery, updatedPreset, without, type ChipKey } from "@/lib/params";
import { rankByData } from "@/lib/search-rank";
import { isHosted } from "@/lib/mode";
import { card, chip } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };
type P = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Dedicated explore page: filters are always on screen; with nothing typed it lists topics and sources to browse. */
export default async function Page({ searchParams }: P) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const hideEmpty = sp.hasdata === "1";
  const q = f.q;
  const searched = !!q || hasFilters(f);
  // findSeries starts now too, so it does not wait for the source list and geo names.
  const hitsCall = searched ? findSeries(f).then((h) => ({ h, e: undefined as unknown }), (e: unknown) => ({ h: [] as SeriesHit[], e })) : undefined;
  const [srcs, names] = await Promise.all([sourceList(), geoNames()]);
  const short = new Map(srcs.map((s) => [s.id, shortSourceName(s.name)]));
  let hits: SeriesHit[] = [], error: unknown;
  if (hitsCall) ({ h: hits, e: error } = await hitsCall);
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
  if (searched && !error && hits.length === 0) {
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
      <SearchForm key={q} q={q} filters={{ ...f, q: undefined }} />
      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <Filters geos={geoOptions} sources={srcOptions} />
        <section aria-labelledby="res" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h1 id="res" className="mr-2 text-lg font-semibold tracking-tight">
              {error ? "Search unavailable" : !searched ? "Explore the catalogue" : `${hits.length >= 25 ? "Top 25" : hits.length} result${hits.length === 1 ? "" : "s"}${q ? ` for “${q}”` : ""}`}
            </h1>
            {chips.map((c) => (
              <Link key={`${c.k}=${c.v ?? ""}`} href={filtersHref(without(f, c.k, c.v))} aria-label={`Remove filter ${c.label}`} className={chip}>
                {c.label} <span aria-hidden className="text-muted-foreground">×</span>
              </Link>
            ))}
            {chips.length > 0 && <Link href={filtersHref({ q, source: [], topic: [] })} className="text-sm text-accent hover:underline">Clear all</Link>}
          </div>
          {error ? <ErrorNote error={error} /> : !searched ? (
            <div className="space-y-6">
              <CoreIndicators cols="sm:grid-cols-2" />
              <Browse srcs={srcOptions} short={short} />
            </div>
          ) : hits.length === 0 ? (
            <EmptyState f={f} understood={understandQuery(q, names)} removals={removals} topics={topicHints} examples={EXAMPLES} srcs={srcs} />
          ) : (
            <Suspense fallback={<HitList hits={hits} short={short} names={names} sp={sp} hideEmpty={false} />}>
              <StatList hits={hits} short={short} names={names} sp={sp} hideEmpty={hideEmpty} />
            </Suspense>
          )}
        </section>
      </div>
    </div>
  );
}

/** Nothing typed yet: topics and sources to start from. */
function Browse({ srcs, short }: { srcs: { id: string; series: number }[]; short: Map<string, string> }) {
  return (
    <div className={`${card} space-y-6 p-6`}>
      <div>
        <h2 className="mb-2 text-sm font-medium">Topics</h2>
        <div className="flex flex-wrap gap-2">{TOPICS.map((t) => <Link key={t} href={filtersHref({ q: "", source: [], topic: [t] })} className={chip}>{t}</Link>)}</div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium">Sources</h2>
        <div className="flex flex-wrap gap-2">
          {srcs.map((s) => <Link key={s.id} href={`/sources/${encodeURIComponent(s.id)}`} className={chip}>{short.get(s.id)} <span className="text-muted-foreground">{s.series.toLocaleString()}</span></Link>)}
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium">Or try</h2>
        <div className="flex flex-wrap gap-2">{EXAMPLES.map((e) => <Link key={e} href={searchHref({ q: e })} className={chip}>{e}</Link>)}</div>
      </div>
    </div>
  );
}

type ListProps = { hits: SeriesHit[]; short: Map<string, string>; names: Map<string, string>; sp: Record<string, string | string[] | undefined>; hideEmpty: boolean };

/** Result cards. Without `stats` they show metadata only (the Suspense fallback, in API order); with them, ranked by stored data. */
function HitList({ hits, short, names, sp, hideEmpty, stats }: ListProps & { stats?: Record<string, SeriesStat> }) {
  const hasData = (h: SeriesHit) => { const s = stats?.[h.series_id]; return !!s && (s.points.length > 0 || !!s.multi); };
  const { ranked, withData } = stats ? rankByData(hits, hasData) : { ranked: hits, withData: hits.length };
  const hidden = hits.length - withData;
  const shown = hideEmpty ? ranked.slice(0, withData) : ranked;
  const toggleQs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => k === "hasdata" ? [] : (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => [k, x] as [string, string])));
  if (!hideEmpty) toggleQs.set("hasdata", "1");
  const toggleHref = `/search${toggleQs.size ? `?${toggleQs}` : ""}`;
  return (
    <div className="space-y-3">
      {(hidden > 0 || hideEmpty) && (
        <p className="text-sm text-muted-foreground">
          <Link href={toggleHref} className="text-accent hover:underline" aria-pressed={hideEmpty}>
            {hideEmpty ? "Show results without stored data" : "Hide results without stored data"}
          </Link>
          {" "}({hideEmpty ? `${hidden} hidden` : `${hidden} of ${hits.length} have none`})
        </p>
      )}
      {shown.map((h) => (
        <ResultCard key={h.series_id} h={h} stat={stats?.[h.series_id]} source={short.get(h.source_id) ?? h.source_id} geo={geoName(names, h.geo)} names={names} liveOk={!isHosted()} pending={!stats} />
      ))}
    </div>
  );
}

/** Awaits the stats (one SQL query) behind Suspense so the cards appear first. */
async function StatList(p: ListProps) {
  return <HitList {...p} stats={await hitStats(p.hits.map((h) => h.series_id))} />;
}
