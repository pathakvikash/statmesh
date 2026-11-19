import Link from "next/link";
import { notFound } from "next/navigation";
import { Citations } from "@/components/Citations";
import { CopyButton } from "@/components/CopyButton";
import { ErrorNote } from "@/components/ErrorNote";
import { GeoLines, RankedBars } from "@/components/GeoExplorer";
import { SeriesChart } from "@/components/SeriesChart";
import { Badge, Latest } from "@/components/SeriesCards";
import { Table } from "@/components/Table";
import { ApiError, describe, observations, search, type ObservationsResult, type SeriesDetail, type SeriesHit } from "@/lib/client";
import { geoLatest, hitStats, geoName, geoNames, geoRows, type SeriesStat } from "@/lib/data";
import { citationLine, coverageYears, freqLabel, periodLabel, relativeTime, seriesHref, shortSourceName, unitLabel } from "@/lib/format";
import { buildChart } from "@/lib/obs";
import { chartMode, defaultGeos, geoNoun, isSubnational, isMultiGeoKey, isRegion, keyMatchSql, pickHeadline, periodsFromRows } from "@/lib/multigeo";
import { sqlLiteral } from "@/lib/sql";
import { btn, card } from "@/lib/ui";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string[] }> };
const TABLE_COLS = ["period_start", "period_end", "geo", "value", "unit", "obs_status"];
const TABLE_MAX = 200;

export default async function Page({ params }: P) {
  const id = (await params).id.map(decodeURIComponent).join("/");
  let d: SeriesDetail;
  try {
    d = await describe(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return <ErrorNote error={e} />;
  }
  const names = await geoNames();
  const leading = d.title.split(/\s+/).slice(0, 4).join(" ");
  // 3-part keys hold one series per geo: with 2+ countries, read per-geo aggregates instead of the (10k-row capped) observations.
  const ml = isMultiGeoKey(id) ? await geoLatest(id) : null;
  const countries = ml?.rows.filter((r) => !isRegion(r.geo)) ?? [];
  const multi = ml && countries.length >= 2 ? ml : null;
  const [o, rel] = await Promise.all([
    (multi ? Promise.resolve({ status: "ok", columns: [], rows: [], truncated: false, citations: [] } as unknown as ObservationsResult) : observations(id)).then((value) => ({ value, error: undefined as unknown })).catch((error: unknown) => ({ value: undefined as ObservationsResult | undefined, error })),
    search({ q: leading }).then((r) => r.hits.filter((h) => h.series_id !== id).slice(0, 5)).catch((): SeriesHit[] => []),
  ]);
  const obs = multi ? undefined : o.value, error = o.error, related = rel;
  const c = d.citation;
  const mv = multi ? await multiView(id, multi, names) : undefined;
  const chart = obs?.status === "ok" ? buildChart(obs.columns, obs.rows, (g) => geoName(names, g)) : undefined;
  const main = chart?.lines[0];
  const stat: SeriesStat | undefined = main && chart && obs ? {
    id, title: d.title, source_id: d.source_id, geo: d.geo, freq: chart.freq, unit: chart.unit ?? d.unit, unitMult: chart.unitMult,
    start: main.points[0].t, end: main.points.at(-1)!.t, retrieved: obs.citations[0]?.retrieved_at ?? "", n: main.points.length, points: main.points,
  } : undefined;
  const geo = geoName(names, d.geo) ?? (d.geos.length ? d.geos.map((g) => geoName(names, g)).join(", ") : null);
  const years = coverageYears(stat?.start ?? d.start, stat?.end ?? d.end);
  const noun = geoNoun(isSubnational(countries.map((r) => r.geo)), countries.length);
  const geoText = multi ? `${countries.length} ${noun}${noun === "countries" && ml!.rows.some((r) => r.geo.startsWith("region:")) ? " and regions" : ""}` : geo;
  const updated = relativeTime(d.last_ingested_at);
  const csvHref = `/api/series-csv?id=${encodeURIComponent(id)}`;
  const snippet = `SELECT geo, period_start, value, unit\nFROM observations\nWHERE ${multi ? keyMatchSql("series_id", [id]) : `series_id = ${sqlLiteral(id)}`}\nORDER BY geo, period_start;`;
  const citation = `${d.title}. ${citationLine(c)}. ${c.source_name} / ${c.dataset_id}.${c.source_url ? ` ${c.source_url}` : ""}`;
  const meta: [string, React.ReactNode][] = [
    ["Series ID", <code key="i" className="break-all font-mono text-xs">{d.series_id}</code>],
    ["Source", `${c.source_name} / ${c.dataset_id}`],
    ["Frequency", freqLabel(stat?.freq ?? mv?.freq ?? d.freq) ?? "n/a"],
    ["Unit", stat?.unit ?? mv?.unit ?? d.unit ?? "n/a"],
    ["Coverage", years || "n/a"],
    ["Geography", geoText ?? "n/a"],
    ["Licence", <a key="l" className="text-accent hover:underline" href={c.licence_url}>{c.licence_name}</a>],
    ["Redistribution", d.redistribute],
    ["Last ingested", updated || "n/a"],
    ["Last updated at source", d.last_updated ?? "n/a"],
  ];

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Search</Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge>{shortSourceName(c.source_name)}</Badge>
          {geoText && <span>{geoText}</span>}
          {freqLabel(stat?.freq ?? mv?.freq ?? d.freq) && <span>· {freqLabel(stat?.freq ?? mv?.freq ?? d.freq)}</span>}
        </div>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight">{d.title}</h1>
        {d.description && <p className="max-w-3xl text-muted-foreground">{d.description}</p>}
      </header>

      {error ? <ErrorNote error={error} /> : null}
      {obs && obs.status !== "ok" && (
        <p role="alert" className="rounded-xl border border-chart-3/50 bg-chart-3/10 p-3 text-sm">
          Observations unavailable: {obs.status}{obs.retry_after ? `. Retry in about ${Math.ceil(obs.retry_after)} s.` : "."}
        </p>
      )}

      {mv && (
        <section aria-label="Chart" className={`${card} p-5`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <Latest s={mv.stat} size="lg" names={names} />
              {mv.summary && <p className="mt-2 text-sm text-muted-foreground">{mv.summary}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={csvHref} download className={btn}>Download CSV</a>
              <CopyButton text={citation} label="Copy citation" />
              <CopyButton text={snippet} label="Copy SQL" />
            </div>
          </div>
          {mv.bars ? <RankedBars rows={mv.bars.rows} noun={mv.noun} unit={mv.unit} period={mv.bars.period} />
            : <GeoLines idKey={id} noun={mv.noun} freq={mv.freq} dk={multi!.dk} unit={mv.unit} candidates={mv.candidates!} initial={mv.initial!} />}
        </section>
      )}

      {stat && chart && (
        <section aria-label="Chart" className={`${card} p-5`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <Latest s={stat} size="lg" />
            <div className="flex flex-wrap gap-2">
              <a href={csvHref} download className={btn}>Download CSV</a>
              <CopyButton text={citation} label="Copy citation" />
              <CopyButton text={snippet} label="Copy SQL" />
            </div>
          </div>
          <SeriesChart rows={chart.rows} lines={chart.lines.map((l) => ({ key: l.key, label: l.label }))} unit={unitLabel(chart.unit ?? d.unit, chart.unitMult)} freq={chart.freq} presets />
          {chart.dropped > 0 && <p className="mt-2 text-xs text-muted-foreground">Showing the {chart.lines.length} longest of {chart.lines.length + chart.dropped} lines.</p>}
        </section>
      )}

      {obs?.status === "ok" && (
        <details className={`${card} group p-5`}>
          <summary className="cursor-pointer text-sm font-medium">
            Observations table <span className="font-normal text-muted-foreground">({obs.rows.length} rows{obs.partial ? ", partial dataset" : obs.truncated ? ", more rows" : ""})</span>
          </summary>
          <div className="mt-4">
            <Table columns={obs.columns.filter((x) => TABLE_COLS.includes(x))}
              rows={obs.rows.slice(-TABLE_MAX).reverse().map((r) => obs.columns.flatMap((x, i) => (TABLE_COLS.includes(x) ? [r[i]] : [])))}
              caption={`${obs.rows.length > TABLE_MAX ? `Latest ${TABLE_MAX} rows, newest first. Download the CSV for all. ` : ""}Source: ${c.source_name}.`} />
          </div>
        </details>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="meta" className={`${card} p-5`}>
          <h2 id="meta" className="mb-3 text-sm font-semibold">Details</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            {meta.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>))}
          </dl>
        </section>
        {related.length > 0 && (
          <section aria-labelledby="rel" className={`${card} p-5`}>
            <h2 id="rel" className="mb-3 text-sm font-semibold">Related series</h2>
            <ul className="space-y-3 text-sm">
              {related.map((h) => (
                <li key={h.series_id}>
                  <Link href={seriesHref(h.series_id)} className="font-medium hover:text-accent hover:underline">{h.title}</Link>
                  <div className="text-xs text-muted-foreground">{[h.source_id, geoName(names, h.geo), freqLabel(h.freq)].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <Citations items={obs?.citations.length ? obs.citations : [c]} />
    </div>
  );
}

/** Everything the multi-geo header and chart need, from per-geo latest values (+ a few full series, or all rows for <=3 periods). */
type MultiView = {
  stat: SeriesStat; summary: string; unit: string; freq: string | null; noun: string;
  bars?: { period: string; rows: { geo: string; name: string; v: number }[] };
  candidates?: { geo: string; name: string }[]; initial?: Record<string, { t: string; v: number }[]>;
};
async function multiView(id: string, ml: NonNullable<Awaited<ReturnType<typeof geoLatest>>>, names: Map<string, string>): Promise<MultiView> {
  const name = (g: string) => geoName(names, g) ?? g;
  const unit = unitLabel(ml.unit, ml.unitMult);
  const few = chartMode(ml.periods) === "bars";
  const noun = geoNoun(isSubnational(ml.rows.filter((r) => !isRegion(r.geo)).map((r) => r.geo)));
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  // Lines mode: the headline, count, median and sparkline come from the same hitStats() query as the search card, never from latest-per-geo rows.
  const hs = few ? undefined : (await hitStats([id]))[id];
  const all = few ? await geoRows(id, ml).catch(() => []) : ml.rows.map((r) => ({ geo: r.geo, t: r.lp, v: r.v }));
  const periods = periodsFromRows(all);
  const period = pickHeadline(periods.map((p) => ({ ...p, w: null })))?.period;
  const at = few ? all.filter((r) => r.t === period && !isRegion(r.geo)) : [];
  const [lo, hi] = [Math.min(...at.map((r) => r.v)), Math.max(...at.map((r) => r.v))];
  const top = at.reduce((b, r) => (r.v > b.v ? r : b), at[0]);
  const t0 = hs?.multi?.top[0];
  const summary = at.length ? `Across ${at.length} ${noun} in ${periodLabel(period, ml.freq)}: ${fmt(lo)} to ${fmt(hi)}${unit ? ` ${unit}` : ""}. Highest: ${name(top.geo)} (${fmt(top.v)}).`
    : t0 ? `Highest in the latest well-covered period: ${name(t0.geo)} (${fmt(t0.v)}).` : "";
  const stat: SeriesStat = {
    id, title: null, source_id: null, geo: null, freq: ml.freq, unit: ml.unit, unitMult: ml.unitMult, start: "", end: "", retrieved: ml.retrieved, n: ml.periods,
    points: hs?.points ?? [], multi: hs?.multi ?? { geos: at.length, sub: noun !== "countries", headline: pickHeadline(periods), spark: "bars", top: [] },
  };
  const base = { stat, summary, unit, freq: ml.freq, noun };
  if (few) return { ...base, bars: { period: periodLabel(period, ml.freq), rows: at.map((r) => ({ geo: r.geo, name: name(r.geo), v: r.v })) } };
  const geos = defaultGeos(ml.rows);
  const rows = await geoRows(id, ml, geos).catch(() => []);
  const initial: Record<string, { t: string; v: number }[]> = Object.fromEntries(geos.map((g) => [g, []]));
  for (const r of rows) initial[r.geo]?.push({ t: r.t, v: r.v });
  const candidates = ml.rows.filter((r) => !r.geo.startsWith("unmapped:")).map((r) => ({ geo: r.geo, name: name(r.geo) })).sort((a, b) => (a.geo === "region:WLD" ? -1 : b.geo === "region:WLD" ? 1 : a.name.localeCompare(b.name)));
  return { ...base, candidates, initial: Object.fromEntries(Object.entries(initial).filter(([, p]) => p.length)) };
}
