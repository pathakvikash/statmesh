import Link from "next/link";
import { notFound } from "next/navigation";
import { Citations } from "@/components/Citations";
import { CompareBar } from "@/components/compare/CompareBar";
import { CompareChart } from "@/components/compare/CompareChart";
import { CopyButton } from "@/components/CopyButton";
import { ErrorNote } from "@/components/ErrorNote";
import { CountryBars, GeoLines, RankedBars } from "@/components/GeoExplorer";
import { SeriesChart } from "@/components/SeriesChart";
import { Badge, Latest } from "@/components/SeriesCards";
import { EmptyCard } from "@/components/series/EmptyCard";
import { SeriesSelects, type SelectSpec } from "@/components/series/SeriesSelects";
import { ValueCard } from "@/components/series/ValueCard";
import { FreqToggle, TabLinks } from "@/components/series/FreqToggle";
import { InsightsSidebar } from "@/components/series/InsightsSidebar";
import { KpiRow } from "@/components/series/KpiRow";
import { ObsExplorer } from "@/components/series/ObsExplorer";
import { ExploreNext } from "@/components/series/ExploreNext";
import { SeriesExplainer } from "@/components/series/SeriesExplainer";
import { SparseChart } from "@/components/series/SparseChart";
import { explainSeries, sparseNote } from "@/lib/series-explain";
import { Provenance } from "@/components/series/Provenance";
import { loadCompare } from "@/components/series/loadCompare";
import { multiView } from "@/components/series/multiView";
import { computeInsights, insightLines, outliers, rankAmong } from "@/lib/insights";
import { ApiError, describe, observations, search, triggerLive, type LiveOutcome, type ObservationsResult, type SeriesDetail, type SeriesHit } from "@/lib/client";
import { isHosted } from "@/lib/mode";
import { datasetInfo, allSources, geoLatest, geoName, geoNames, hitStats, medianByPeriod, seriesShape, type GeoInfo, type Pt, type SeriesStat } from "@/lib/data";
import { parseCompareParam } from "@/lib/compare";
import { citationLine, coverageYears, freqLabel, parentHref, periodLabel, seriesHref, shortSourceName, unitLabel } from "@/lib/format";
import { buildChart } from "@/lib/obs";
import { geoNoun, isSubnational, isMultiGeoKey, isRegion, keyMatchSql, medianLabel, withMedian } from "@/lib/multigeo";
import { sqlLiteral } from "@/lib/sql";
import { dimensionLabel } from "@/lib/dimension-labels";
import { chooseDims, chooseFreq, chooseView, choiceDims, dimLabel, dominant, dominantCombo, emptyReason, rowMatches, shapeFromRows, type ShapeStatus } from "@/lib/shape";
import { btn, card } from "@/lib/ui";

export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
type P = { params: Promise<{ id: string[] }>; searchParams: Promise<SP> };
const TABLE_COLS = ["period_start", "period_end", "geo", "value", "unit", "obs_status"];
const TABLE_MAX = 200;
const DATASET_STATUSES: ShapeStatus[] = ["ingested", "remote", "stale"];

export default async function Page({ params, searchParams }: P) {
  const id = (await params).id.map(decodeURIComponent).join("/");
  // `src:ds` is a dataset-level search hit (a dataset with no listed series): it has no series page.
  const dsParts = id.split(":");
  if (dsParts.length === 2 && dsParts[0] && dsParts[1]) return <DatasetHit src={dsParts[0]} ds={dsParts[1]} />;
  const sp = await searchParams;
  let d: SeriesDetail;
  try {
    d = await describe(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return <ErrorNote error={e} />;
  }
  const names = await geoNames();
  const leading = d.title.split(/\s+/).slice(0, 4).join(" ");
  let shape = await seriesShape(id);
  // An empty series may be an on-demand dataset: one API call (limit 1, all geos) fetches its rows, then the shape is read again.
  // Not on hosted instances. A live fetch that still leaves it empty is not repeated (see triggerLive's 60 s memo).
  const live = !isHosted() && (!shape || shape.rows === 0) ? await triggerLive(id, 20_000) : undefined;
  if (live?.loaded) shape = await seriesShape(id);
  const dimsAll = shape?.dims ?? {};
  const choice = choiceDims(dimsAll);
  const urlDims = choice.some((k) => str(sp[`dim.${k}`]));
  const selAll = choice.length ? chooseDims(strs(sp), dimsAll) : undefined;
  // 3-part keys hold one series per geo: with 2+ countries, read per-geo aggregates instead of the (10k-row capped) observations.
  // The chosen dimension values drive them; with no match and no explicit choice, fall back to the dominant combination.
  let ml = isMultiGeoKey(id) ? await geoLatest(id, selAll) : null;
  let selMulti = selAll;
  if (isMultiGeoKey(id) && !urlDims && (ml?.rows.filter((r) => !isRegion(r.geo)).length ?? 0) < 2) {
    ml = await geoLatest(id);
    selMulti = undefined;
  }
  const countries = ml?.rows.filter((r) => !isRegion(r.geo)) ?? [];
  const multi = ml && countries.length >= 2 ? ml : null;
  // Compare mode: up to 3 more series drawn for the same countries (only for 3-part keys with geo data).
  const compareOn = !!ml && isMultiGeoKey(id) && !!str(sp.compare)?.trim();
  const cmp = ml && isMultiGeoKey(id) ? parseCompareParam(str(sp.compare), id) : undefined;
  // A live fetch that left the series empty is the observations answer: reuse it rather than fetching again.
  const liveErr = live?.status === "error";
  const fromLive = live && !live.loaded && !liveErr ? liveObs(id, live) : undefined;
  const obsCall: Promise<ObservationsResult | undefined> = multi ? Promise.resolve(undefined)
    : live && !live.loaded ? Promise.resolve(fromLive) : observations(id);
  // Parent 3-part key's latest value per geo (Compare tab, rank KPI): reuse ml for 3-part ids, one more query for per-geo ids.
  const parentKey = id.split(":").slice(0, 3).join(":");
  // Same dimension choice as the page; with no match and no explicit choice, the dominant combination.
  let pgSel = selAll; // the selection pg is built with; cleared when it falls back to the dominant combination
  const parentCall: Promise<GeoInfo | null> = isMultiGeoKey(id) ? Promise.resolve(ml) : id.split(":").length > 3
    ? geoLatest(parentKey, selAll).then((g) => {
      if (urlDims || (g?.rows.filter((r) => !isRegion(r.geo)).length ?? 0) >= 2) return g;
      pgSel = undefined;
      return geoLatest(parentKey);
    }) : Promise.resolve(null);
  const [o, rel, srcs, pg] = await Promise.all([
    obsCall.then((value) => ({ value, error: undefined as unknown })).catch((error: unknown) => ({ value: undefined as ObservationsResult | undefined, error })),
    search({ q: leading }).then(async (r) => {
      const hits = r.hits.filter((h) => h.series_id !== id).slice(0, 5);
      return { hits, stats: await hitStats(hits.map((h) => h.series_id)) };
    }).catch(() => ({ hits: [] as SeriesHit[], stats: {} as Record<string, SeriesStat> })),
    allSources().catch(() => []),
    parentCall,
  ]);
  const obs = multi ? undefined : o.value, error = o.error, related = rel.hits;
  const c = d.citation;
  const mv = multi && !compareOn ? await multiView(id, multi, names, selMulti) : undefined;
  const cmpData = compareOn && ml && cmp ? await loadCompare(id, d.title, ml, selMulti, cmp, str(sp.geo), names) : undefined;
  const chips = (cmp?.ids ?? []).map((cid) => {
    const s = cmpData?.series.find((x) => x.id === cid);
    return { id: cid, title: s?.title ?? cid, unit: s?.unit ?? "" };
  });

  // Single-geo path: the observations we loaded, narrowed by the chosen frequency and dimension values.
  const ok = obs?.status === "ok" ? obs : undefined;
  const cols = ok?.columns ?? [];
  const at = (k: string) => cols.indexOf(k);
  const items = (ok?.rows ?? []).flatMap((raw) => {
    const v = raw[at("value")], t = raw[at("period_start")];
    if (typeof v !== "number" || !t) return [];
    const dims = raw[at("dims")];
    return [{ raw, v, t: String(t), geo: (raw[at("geo")] as string | null) ?? null, freq: (raw[at("freq")] as string | null) ?? null,
      dims: dims && typeof dims === "object" ? (dims as Record<string, unknown>) : {} }];
  });
  const freqOpts = shape?.freqs.length ? shape.freqs : shapeFromRows(items).freqs;
  const freqUse = chooseFreq(str(sp.freq), freqOpts) ?? dominant(items.map((i) => i.freq));
  const freqItems = items.filter((i) => freqUse === undefined || i.freq === freqUse);
  const combo = dominantCombo(freqItems, choice);
  let sel = chooseDims(strs(sp), dimsAll);
  let rowsSel = freqItems.filter((i) => rowMatches(i.dims, sel));
  if (!rowsSel.length && choice.length && !choice.some((k) => str(sp[`dim.${k}`]))) {
    sel = Object.fromEntries(choice.map((k) => [k, combo[k]]).filter(([, v]) => v !== undefined)) as Record<string, string>;
    rowsSel = freqItems.filter((i) => rowMatches(i.dims, sel));
  }
  const eff = shapeFromRows(rowsSel.map((i) => ({ geo: i.geo, t: i.t, freq: i.freq, dims: i.dims })));
  const view = rowsSel.length ? chooseView(eff) : "empty";

  const chart = view === "line" || view === "multi-line" ? buildChart(cols, rowsSel.map((i) => i.raw), (g) => geoName(names, g)) : undefined;
  const main = chart?.lines[0];
  const stat: SeriesStat | undefined = main && chart && obs ? {
    id, title: d.title, source_id: d.source_id, geo: d.geo, freq: chart.freq, unit: chart.unit ?? d.unit, unitMult: chart.unitMult,
    start: main.points[0].t, end: main.points.at(-1)!.t, retrieved: obs!.citations[0]?.retrieved_at ?? "", n: main.points.length, points: main.points,
  } : undefined;
  const last = rowsSel.at(-1);
  const geo = geoName(names, d.geo) ?? (d.geos.length ? d.geos.map((g) => geoName(names, g)).join(", ") : null);
  const years = coverageYears(stat?.start ?? d.start, stat?.end ?? d.end);
  const noun = geoNoun(isSubnational(countries.map((r) => r.geo)), countries.length);
  const geoText = multi ? `${countries.length} ${noun}${noun === "countries" && ml!.rows.some((r) => r.geo.startsWith("region:")) ? " and regions" : ""}` : geo;
  const csvHref = `/api/series-csv?id=${encodeURIComponent(id)}`;
  const snippet = `SELECT geo, period_start, value, unit\nFROM observations\nWHERE ${multi ? keyMatchSql("series_id", [id]) : `series_id = ${sqlLiteral(id)}`}\nORDER BY geo, period_start;`;
  const citation = `${d.title}. ${citationLine(c)}. ${c.source_name} / ${c.dataset_id}.${c.source_url ? ` ${c.source_url}` : ""}`;
  const freqText = freqLabel(stat?.freq ?? mv?.freq ?? (freqUse ?? d.freq));
  const dsStatus: ShapeStatus = shape && shape.status !== "unknown" ? shape.status
    : (DATASET_STATUSES as string[]).includes(d.status) ? (d.status as ShapeStatus) : "unknown";
  const shownSel = multi ? (selMulti ?? chooseDims({}, dimsAll)) : sel;
  const selects: SelectSpec[] = choice.map((k) => ({
    param: `dim.${k}`, label: dimLabel(k), value: shownSel[k] ?? dimsAll[k][0],
    options: dimsAll[k].map((v) => ({ value: v, label: dimensionLabel(k, v) })),
  }));
  const freqToggle = !mv && freqOpts.length > 1;

  // Computed figures (lib/insights.ts) from the points drawn: the longest line, or the single value.
  const lineView = view === "line" || view === "multi-line";
  const pts: Pt[] = main?.points ?? (view === "value" && last ? [{ t: last.t, v: last.v }] : []);
  const unitTxt = unitLabel(chart?.unit ?? stat?.unit ?? d.unit, chart?.unitMult ?? stat?.unitMult);
  const showKpi = !mv && !compareOn && (lineView || view === "value") && pts.length > 0;
  const ins = showKpi ? computeInsights(pts, unitTxt) : null;
  const unusual = ins ? outliers(pts) : null;
  const pgCountries = (pg?.rows ?? []).filter((r) => !isRegion(r.geo));
  const pgBars = pgCountries.map((r) => ({ geo: r.geo, name: geoName(names, r.geo) ?? r.geo, v: r.v }));
  const compareOk = showKpi && pgBars.length >= 2;
  const lineFreq = chart?.freq ?? freqUse ?? d.freq;
  const multiLine = (chart?.lines.length ?? 0) > 1;
  const pgNoun = geoNoun(isSubnational(pgCountries.map((r) => r.geo)), 2);
  // Rank describes one geo: hide it when several lines are drawn or the parent's frequency differs from this series'.
  const rawRank = ins && !multiLine && pg && pg.freq === lineFreq ? rankAmong(pgCountries, d.geo) : null;
  const rank = rawRank ? { ...rawRank, noun: pgNoun } : null;
  // Country vs median: the parent's per-period median over countries (computed), drawn dashed on the country's own trend.
  // Same selection pg was built with: selAll, or none when pg fell back to the dominant combination.
  const medAll = chart && lineView && !multiLine && d.geo && pg && pg.freq === lineFreq && !isMultiGeoKey(id)
    ? await medianByPeriod(parentKey, pg, pgSel) : [];
  const medPts = (medAll.at(-1)?.n ?? 0) >= 2 ? medAll : []; // a median of 1 country is just the country
  const medKey = medPts.length ? medianLabel(medPts.at(-1)!.n, isSubnational(pgCountries.map((r) => r.geo))) : null;
  const lineLabel = multiLine ? main?.label : null;
  const srcNote = `${c.source_name} / ${c.dataset_id}${c.retrieved_at ? `, retrieved ${c.retrieved_at.slice(0, 10)}` : ""}`;
  const sourceRow = srcs.find((x) => x.id === d.source_id);
  const tabsOn = showKpi && lineView;
  const tabOpts = [{ id: "trend", label: "Trend" }, ...(compareOk ? [{ id: "compare", label: "Compare" }] : []),
    ...(ok && ok.rows.length ? [{ id: "data", label: "Data" }] : [])];
  const tab = tabOpts.find((t) => t.id === str(sp.tab))?.id ?? "trend";
  const obsExplorer = ok && ok.rows.length > 0 ? (
    <ObsExplorer id={id} csvHref={csvHref} citations={obs?.citations.length ? obs.citations : [c]}
      columns={ok.columns.filter((x) => TABLE_COLS.includes(x))}
      rows={ok.rows.slice(-TABLE_MAX).reverse().map((r) => ok.columns.flatMap((x, i) => (TABLE_COLS.includes(x) ? [r[i]] : [])))}
      caption={`${ok.rows.length > TABLE_MAX ? `Showing latest ${TABLE_MAX} of ${ok.rows.length}; CSV has all rows` : `${ok.rows.length} rows`}, newest first${ok.partial ? ", partial dataset" : ok.truncated ? ", more rows exist beyond those loaded" : ""}. Source: ${c.source_name}.`} />
  ) : null;
  const compareBars = compareOk ? (
    <div>
      <RankedBars rows={pgBars} highlight={d.geo ?? undefined} noun={geoNoun(isSubnational(pgCountries.map((r) => r.geo)), pgCountries.length)} unit={unitLabel(pg!.unit, pg!.unitMult)} period="the latest period available per country" />
      <p className="mt-2 text-xs text-muted-foreground">Source: {srcNote}.</p>
    </div>
  ) : null;

  // Always a graph: a value view gets bars of every stored point; empty series offer related ones.
  const sparsePts: Pt[] = view === "value" && last
    ? rowsSel.filter((r) => r.geo === last.geo).map((r) => ({ t: r.t, v: r.v })).sort((a, b) => a.t.localeCompare(b.t)) : [];
  const relatedWithData = related.flatMap((h) => { const s = rel.stats[h.series_id]; return s && s.points.length >= 2 ? [{ id: h.series_id, title: h.title, stat: s }] : []; });
  const leadText = explainSeries(d, { sourceName: c.source_name, geoText, freqText, unitText: unitTxt, coverage: years }).lead;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <Link href="/search" className="hover:text-foreground">← Search</Link>
        {id.split(":").length > 3 && <Link href={parentHref(id, strs(sp))} className="hover:text-foreground">← Back to all countries</Link>}
      </div>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge>{shortSourceName(c.source_name)}</Badge>
          {geoText && <span>{geoText}</span>}
          {freqText && <span>· {freqText}</span>}
        </div>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight">{d.title}</h1>
        <SeriesExplainer d={d} sp={strs(sp)} canCompare={tabsOn && compareOk} hasTrend={lineView && pts.length >= 2}
          o={{ sourceName: c.source_name, geoText, freqText, unitText: unitTxt, coverage: years, periods: stat?.n ?? (rowsSel.length ? eff.periods.n : 0) }} />
        {live?.loaded && (
          <p role="status" className="text-xs text-muted-foreground">
            Loaded live from {live.source ?? c.source_name} just now{live.retrieved ? `, retrieved ${live.retrieved.slice(0, 16).replace("T", " ")}` : ""}.
          </p>
        )}
        {ml && isMultiGeoKey(id) && <CompareBar selfId={id} title={d.title} selected={chips} />}
      </header>

      {error ? <ErrorNote error={error} /> : null}
      {obs && obs.status !== "ok" && (
        <p role="alert" className="rounded-xl border border-chart-3/50 bg-chart-3/10 p-3 text-sm">
          Observations unavailable: {obs.status}{obs.retry_after ? `. Retry in about ${Math.ceil(obs.retry_after)} s.` : "."}
        </p>
      )}

      {ins && <KpiRow ins={ins} points={pts} freq={chart?.freq ?? stat?.freq ?? d.freq} unit={chart?.unit ?? stat?.unit ?? d.unit}
        mult={chart?.unitMult ?? stat?.unitMult} rank={rank} source={srcNote} label={lineLabel} />}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
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
          <SeriesSelects selects={selects} />
          {mv.bars ? <CountryBars idKey={id} query={strs(sp)} rows={mv.bars.rows} noun={mv.noun} unit={mv.unit} period={mv.bars.period} />
            : <GeoLines idKey={id} noun={mv.noun} freq={mv.freq} dk={multi!.dk} sel={selMulti} unit={mv.unit} candidates={mv.candidates!} initial={mv.initial!} />}
        </section>
      )}

      {cmpData && (
        <section aria-label="Chart" className={`${card} p-5`}>
          <SeriesSelects selects={selects} />
          <CompareChart series={cmpData.series} geos={cmpData.geos} geoOptions={cmpData.geoOptions} notes={cmpData.notes} slug={id} />
        </section>
      )}

      {!mv && !compareOn && view === "empty" && (
        <EmptyCard source={d.source_id} sourceName={shortSourceName(c.source_name)}
          related={relatedWithData} lead={leadText}
          reason={emptyReason({
            obs, error: !!error || liveErr, dataset: dsStatus, source: d.source_id, datasetId: d.dataset_id,
            hosted: isHosted(),
          })} />
      )}

      {!mv && !compareOn && view !== "empty" && (
        <section aria-label="Chart" className={`${card} p-5`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            {stat ? <Latest s={stat} size="lg" /> : last ? (
              <div className="text-sm text-muted-foreground">{rowsSel.length} rows · {eff.geos} {eff.geos === 1 ? "geo" : "geos"} · {eff.periods.n} {eff.periods.n === 1 ? "period" : "periods"}</div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <a href={csvHref} download className={btn}>Download CSV</a>
              <CopyButton text={citation} label="Copy citation" />
              <CopyButton text={snippet} label="Copy SQL" />
            </div>
          </div>
          {sparsePts.length > 0 && (
            <div className="mb-4">
              <SparseChart points={sparsePts} freq={freqUse ?? d.freq} unit={unitLabel(d.unit)} />
              <p className="mt-2 text-xs text-muted-foreground">{sparseNote(sparsePts, freqUse ?? d.freq, c.source_name)}</p>
            </div>
          )}
          {tabsOn && <div className="mb-4"><TabLinks tabs={tabOpts} value={tab} sp={sp} /></div>}
          {(!tabsOn || tab === "trend") && <SeriesSelects selects={selects} />}
          {freqToggle && (!tabsOn || tab === "trend") && <FreqToggle opts={freqOpts} value={freqUse!} sp={sp} />}
          {view === "value" && last && (
            <ValueCard headline={!ins} value={last.v} unit={d.unit} mult={null} period={last.t} freq={freqUse ?? d.freq}
              geo={geoName(names, last.geo ?? d.geo)}
              others={rowsSel.filter((r) => r.t === last.t && r.geo !== last.geo).map((r) => ({ geo: geoName(names, r.geo) ?? r.geo ?? "", v: r.v }))} />
          )}
          {view === "value" && (compareBars || related.some((h) => rel.stats[h.series_id]?.points.length)) && (
            <div className="mt-6 space-y-4 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Compare</h3>
              {compareBars}
              {related.some((h) => rel.stats[h.series_id]?.points.length) && (
                <ul className="space-y-1 text-sm" aria-label="Related series, latest values">
                  {related.flatMap((h) => {
                    const s = rel.stats[h.series_id], l = s?.points.at(-1);
                    return s && l ? [<li key={h.series_id}><Link href={seriesHref(h.series_id)} className="hover:text-accent hover:underline">{h.title}</Link>{": "}
                      <span className="tabular-nums">{l.v.toLocaleString("en-US", { maximumFractionDigits: 3 })} {unitLabel(s.unit, s.unitMult)}</span>
                      <span className="text-muted-foreground"> ({periodLabel(l.t, s.freq)}; {s.source_id ?? h.source_id})</span></li>] : [];
                  })}
                </ul>
              )}
            </div>
          )}
          {view === "ranked" && last && (
            <RankedBars highlight={d.geo ?? undefined} period={periodLabel(last.t, freqUse ?? d.freq)} unit={unitLabel(d.unit)} noun={noun}
              rows={rowsSel.filter((r) => r.t === last.t && r.geo).map((r) => ({ geo: r.geo!, name: geoName(names, r.geo) ?? r.geo!, v: r.v }))} />
          )}
          {tabsOn && tab === "compare" && compareBars}
          {tabsOn && tab === "data" && obsExplorer}
          {chart && lineView && (!tabsOn || tab === "trend") && (
            <>
              <SeriesChart rows={medKey ? withMedian(chart.rows, medPts, medKey) : chart.rows}
                lines={[...chart.lines.map((l) => ({ key: l.key, label: l.label })), ...(medKey ? [{ key: medKey, label: medKey, dashed: true }] : [])]} unit={unitLabel(chart.unit ?? d.unit, chart.unitMult)} freq={chart.freq} presets outliers={unusual ?? undefined} />
              {main && main.points.length < 5 && <p className="mt-2 text-xs text-muted-foreground">{sparseNote(main.points, chart.freq, c.source_name)}</p>}
              {medKey && <p className="mt-2 text-xs text-muted-foreground">{medKey}: median of each period&apos;s values across the {pgNoun} of <Link href={parentHref(id, strs(sp))} className="hover:text-accent hover:underline">{parentKey}</Link>. Source: {srcNote}.</p>}
              {chart.dropped > 0 && <p className="mt-2 text-xs text-muted-foreground">Showing the {chart.lines.length} longest of {chart.lines.length + chart.dropped} lines.</p>}
            </>
          )}
        </section>
      )}

      {!tabsOn && !mv && obsExplorer && (
        <details className={`${card} group p-5`}>
          <summary className="cursor-pointer text-sm font-medium">Observations table <span className="font-normal text-muted-foreground">({ok!.rows.length} rows)</span></summary>
          <div className="mt-4">{obsExplorer}</div>
        </details>
      )}

      <Provenance d={d} c={c} source={sourceRow} coverage={years} snippet={snippet} citation={citation}
        freq={freqText} unit={stat?.unit ?? mv?.unit ?? d.unit} geo={geoText} />

      <ExploreNext id={id} geo={id.split(":").length > 3 ? d.geo ?? undefined : undefined} countryName={geoName(names, d.geo)} />
      </div>
      <InsightsSidebar lines={insightLines(ins, chart?.freq ?? d.freq, unitTxt, unusual)} n={ins?.n ?? 0} source={srcNote} scope={lineLabel}
        names={names} d={d} />
      </div>
      <Citations items={obs?.citations.length ? obs.citations : [c]} />
    </div>
  );
}

/** The observations answer for a series a live fetch left empty: the API's status and warning, no rows. */
const liveObs = (id: string, l: LiveOutcome): ObservationsResult => ({
  series_id: id, status: l.status as ObservationsResult["status"], columns: [], rows: [], truncated: false,
  citations: [], warning: l.warning, retry_after: l.retry_after,
});

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Search params as plain strings, for the dimension chooser. */
const strs = (sp: SP): Record<string, string | undefined> => Object.fromEntries(Object.keys(sp).map((k) => [k, str(sp[k])]));

async function DatasetHit({ src, ds }: { src: string; ds: string }) {
  const d = await datasetInfo(src, ds);
  if (!d) notFound();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={`/sources/${encodeURIComponent(src)}`} className="text-sm text-muted-foreground hover:underline">&larr; {src}</Link>
      <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
      <div className={`${card} space-y-3 p-5 text-sm`}>
        <p>This is a whole dataset from the source, not a single series. {d.series > 0 ? `${d.series} individual series are listed in the catalogue` : "No individual series are listed in the catalogue yet"}
          (status {d.status ?? "unknown"}).</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/sources/${encodeURIComponent(src)}`} className={btn}>Open the source page</Link>
          <Link href={`/search?q=${encodeURIComponent(d.title)}&source=${encodeURIComponent(src)}`} className={btn}>Search this source for it</Link>
        </div>
      </div>
    </div>
  );
}
