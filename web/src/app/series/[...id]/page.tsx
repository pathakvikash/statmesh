import Link from "next/link";
import { notFound } from "next/navigation";
import { Citations } from "@/components/Citations";
import { CompareBar } from "@/components/compare/CompareBar";
import { CompareChart, type CompareSeries } from "@/components/compare/CompareChart";
import { CopyButton } from "@/components/CopyButton";
import { ErrorNote } from "@/components/ErrorNote";
import { GeoLines, RankedBars } from "@/components/GeoExplorer";
import { SeriesChart } from "@/components/SeriesChart";
import { Badge, Latest } from "@/components/SeriesCards";
import { EmptyCard } from "@/components/series/EmptyCard";
import { SeriesSelects, type SelectSpec } from "@/components/series/SeriesSelects";
import { ValueCard } from "@/components/series/ValueCard";
import { Table } from "@/components/Table";
import { ApiError, describe, observations, search, type ObservationsResult, type SeriesDetail, type SeriesHit } from "@/lib/client";
import { geoLatest, geoName, geoNames, geoRows, hitStats, seriesShape, type GeoInfo, type SeriesStat } from "@/lib/data";
import { parseCompareParam, parseGeoParam } from "@/lib/compare";
import { citationLine, coverageYears, freqLabel, periodLabel, relativeTime, seriesHref, shortSourceName, unitLabel } from "@/lib/format";
import { buildChart } from "@/lib/obs";
import { chartMode, defaultGeos, geoNoun, isSubnational, isMultiGeoKey, isRegion, keyMatchSql, pickHeadline, periodsFromRows, type PeriodStat } from "@/lib/multigeo";
import { sqlLiteral } from "@/lib/sql";
import { chooseDims, chooseFreq, chooseView, choiceDims, dimLabel, dominant, dominantCombo, emptyReason, rowMatches, shapeFromRows, valueLabel, type ShapeStatus } from "@/lib/shape";
import { btn, card } from "@/lib/ui";

export const dynamic = "force-dynamic";
type SP = Record<string, string | string[] | undefined>;
type P = { params: Promise<{ id: string[] }>; searchParams: Promise<SP> };
const TABLE_COLS = ["period_start", "period_end", "geo", "value", "unit", "obs_status"];
const TABLE_MAX = 200;
const DATASET_STATUSES: ShapeStatus[] = ["ingested", "remote", "stale"];

export default async function Page({ params, searchParams }: P) {
  const id = (await params).id.map(decodeURIComponent).join("/");
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
  const shape = await seriesShape(id);
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
  const [o, rel] = await Promise.all([
    (multi ? Promise.resolve({ status: "ok", columns: [], rows: [], truncated: false, citations: [] } as unknown as ObservationsResult) : observations(id)).then((value) => ({ value, error: undefined as unknown })).catch((error: unknown) => ({ value: undefined as ObservationsResult | undefined, error })),
    search({ q: leading }).then((r) => r.hits.filter((h) => h.series_id !== id).slice(0, 5)).catch((): SeriesHit[] => []),
  ]);
  const obs = multi ? undefined : o.value, error = o.error, related = rel;
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
  const updated = relativeTime(d.last_ingested_at);
  const csvHref = `/api/series-csv?id=${encodeURIComponent(id)}`;
  const snippet = `SELECT geo, period_start, value, unit\nFROM observations\nWHERE ${multi ? keyMatchSql("series_id", [id]) : `series_id = ${sqlLiteral(id)}`}\nORDER BY geo, period_start;`;
  const citation = `${d.title}. ${citationLine(c)}. ${c.source_name} / ${c.dataset_id}.${c.source_url ? ` ${c.source_url}` : ""}`;
  const freqText = freqLabel(stat?.freq ?? mv?.freq ?? (freqUse ?? d.freq));
  const meta: [string, React.ReactNode][] = [
    ["Series ID", <code key="i" className="break-all font-mono text-xs">{d.series_id}</code>],
    ["Source", `${c.source_name} / ${c.dataset_id}`],
    ["Frequency", freqText ?? "n/a"],
    ["Unit", stat?.unit ?? mv?.unit ?? d.unit ?? "n/a"],
    ["Coverage", years || "n/a"],
    ["Geography", geoText ?? "n/a"],
    ["Licence", <a key="l" className="text-accent hover:underline" href={c.licence_url}>{c.licence_name}</a>],
    ["Redistribution", d.redistribute],
    ["Last ingested", updated || "n/a"],
    ["Last updated at source", d.last_updated ?? "n/a"],
  ];
  const dsStatus: ShapeStatus = shape && shape.status !== "unknown" ? shape.status
    : (DATASET_STATUSES as string[]).includes(d.status) ? (d.status as ShapeStatus) : "unknown";
  const shownSel = multi ? (selMulti ?? chooseDims({}, dimsAll)) : sel;
  const selects: SelectSpec[] = choice.map((k) => ({
    param: `dim.${k}`, label: dimLabel(k), value: shownSel[k] ?? dimsAll[k][0],
    options: dimsAll[k].map((v) => ({ value: v, label: valueLabel(v) })),
  }));
  const freqToggle = !mv && freqOpts.length > 1;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Search</Link>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge>{shortSourceName(c.source_name)}</Badge>
          {geoText && <span>{geoText}</span>}
          {freqText && <span>· {freqText}</span>}
        </div>
        <h1 className="max-w-4xl text-3xl font-semibold tracking-tight">{d.title}</h1>
        {d.description && <p className="max-w-3xl text-muted-foreground">{d.description}</p>}
        {ml && isMultiGeoKey(id) && <CompareBar selfId={id} title={d.title} selected={chips} />}
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
          <SeriesSelects selects={selects} />
          {mv.bars ? <RankedBars rows={mv.bars.rows} noun={mv.noun} unit={mv.unit} period={mv.bars.period} />
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
          reason={emptyReason({
            obs: obs && { status: obs.status, retry_after: obs.retry_after, warning: (obs as { warning?: string | null }).warning },
            error: !!error, dataset: dsStatus, source: d.source_id, datasetId: d.dataset_id,
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
          <SeriesSelects selects={selects} />
          {freqToggle && <FreqToggle opts={freqOpts} value={freqUse!} sp={sp} />}
          {view === "value" && last && (
            <ValueCard value={last.v} unit={d.unit} mult={null} period={last.t} freq={freqUse ?? d.freq}
              geo={geoName(names, last.geo ?? d.geo)}
              others={rowsSel.filter((r) => r.t === last.t && r.geo !== last.geo).map((r) => ({ geo: geoName(names, r.geo) ?? r.geo ?? "", v: r.v }))} />
          )}
          {view === "ranked" && last && (
            <RankedBars period={periodLabel(last.t, freqUse ?? d.freq)} unit={unitLabel(d.unit)} noun={noun}
              rows={rowsSel.filter((r) => r.t === last.t && r.geo).map((r) => ({ geo: r.geo!, name: geoName(names, r.geo) ?? r.geo!, v: r.v }))} />
          )}
          {chart && (view === "line" || view === "multi-line") && (
            <>
              <SeriesChart rows={chart.rows} lines={chart.lines.map((l) => ({ key: l.key, label: l.label }))} unit={unitLabel(chart.unit ?? d.unit, chart.unitMult)} freq={chart.freq} presets />
              {chart.dropped > 0 && <p className="mt-2 text-xs text-muted-foreground">Showing the {chart.lines.length} longest of {chart.lines.length + chart.dropped} lines.</p>}
            </>
          )}
        </section>
      )}

      {ok && ok.rows.length > 0 && (
        <details className={`${card} group p-5`}>
          <summary className="cursor-pointer text-sm font-medium">
            Observations table <span className="font-normal text-muted-foreground">({ok.rows.length} rows{ok.partial ? ", partial dataset" : ok.truncated ? ", more rows" : ""})</span>
          </summary>
          <div className="mt-4">
            <Table columns={ok.columns.filter((x) => TABLE_COLS.includes(x))}
              rows={ok.rows.slice(-TABLE_MAX).reverse().map((r) => ok.columns.flatMap((x, i) => (TABLE_COLS.includes(x) ? [r[i]] : [])))}
              caption={`${ok.rows.length > TABLE_MAX ? `Latest ${TABLE_MAX} rows, newest first. Download the CSV for all. ` : ""}Source: ${c.source_name}.`} />
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

/**
 * Compare mode: the main series and each compared series for the chosen countries. Compared series use their
 * dominant dimension combination; the main series uses the page's dimension selection. Missing series are noted, not fatal.
 */
async function loadCompare(id: string, title: string, ml: GeoInfo, sel: Record<string, string> | undefined,
  cmp: { ids: string[]; tooMany: boolean; rejected: string[] }, geoParam: string | undefined, names: Map<string, string>) {
  const avail = ml.rows.filter((r) => !r.geo.startsWith("unmapped:")).map((r) => r.geo);
  const geos = parseGeoParam(geoParam, avail, defaultGeos(ml.rows, 3));
  const notes: string[] = [];
  if (cmp.tooMany) notes.push("Only 3 series can be compared; the first 3 are shown.");
  if (cmp.rejected.length) notes.push(`Ignored: ${cmp.rejected.join(", ")} (not a series id).`);
  const series: CompareSeries[] = [{ id, title, unit: unitLabel(ml.unit, ml.unitMult), freq: ml.freq, points: await geoRows(id, ml, geos, sel) }];
  for (const cid of cmp.ids) {
    try {
      const [info, det] = await Promise.all([geoLatest(cid), describe(cid).catch(() => null)]);
      if (!info || !det) { notes.push(`No observations for ${cid}.`); continue; }
      series.push({ id: cid, title: det.title, unit: unitLabel(info.unit, info.unitMult), freq: info.freq, points: await geoRows(cid, info, geos) });
    } catch {
      notes.push(`Could not load ${cid}.`);
    }
  }
  return { series, geos, notes, geoOptions: avail.map((g) => ({ geo: g, name: geoName(names, g) ?? g })) };
}

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Search params as plain strings, for the dimension chooser. */
const strs = (sp: SP): Record<string, string | undefined> => Object.fromEntries(Object.keys(sp).map((k) => [k, str(sp[k])]));

/** Frequency toggle: one link per frequency, each keeping the other params. */
function FreqToggle({ opts, value, sp }: { opts: string[]; value: string; sp: SP }) {
  const base = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])) as [string, string][]);
  return (
    <div role="group" aria-label="Frequency" className="mb-4 inline-flex flex-wrap rounded-lg border border-border p-0.5 text-sm">
      {opts.map((f) => {
        const u = new URLSearchParams(base);
        u.set("freq", f);
        const on = f === value;
        return (
          <a key={f} href={`?${u}`} aria-current={on ? "true" : undefined}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {freqLabel(f) ?? f}
          </a>
        );
      })}
    </div>
  );
}

/** Everything the multi-geo header and chart need, from per-geo latest values (+ a few full series, or all rows for <=3 periods). */
type MultiView = {
  stat: SeriesStat; summary: string; unit: string; freq: string | null; noun: string;
  bars?: { period: string; rows: { geo: string; name: string; v: number }[] };
  candidates?: { geo: string; name: string }[]; initial?: Record<string, { t: string; v: number }[]>;
};
async function multiView(id: string, ml: NonNullable<Awaited<ReturnType<typeof geoLatest>>>, names: Map<string, string>, sel?: Record<string, string>): Promise<MultiView> {
  const name = (g: string) => geoName(names, g) ?? g;
  const unit = unitLabel(ml.unit, ml.unitMult);
  const few = chartMode(ml.periods) === "bars";
  const noun = geoNoun(isSubnational(ml.rows.filter((r) => !isRegion(r.geo)).map((r) => r.geo)));
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  // Lines mode: the headline, count, median and sparkline come from the same hitStats() query as the search card, never from latest-per-geo rows.
  const hs = few ? undefined : (await hitStats([id]))[id];
  const all = few ? await geoRows(id, ml, undefined, sel).catch(() => []) : ml.rows.map((r) => ({ geo: r.geo, t: r.lp, v: r.v }));
  const periods = periodsFromRows(all);
  const period = pickHeadline(periods.map((p: PeriodStat) => ({ ...p, w: null })))?.period;
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
  const rows = await geoRows(id, ml, geos, sel).catch(() => []);
  const initial: Record<string, { t: string; v: number }[]> = Object.fromEntries(geos.map((g) => [g, []]));
  for (const r of rows) initial[r.geo]?.push({ t: r.t, v: r.v });
  const candidates = ml.rows.filter((r) => !r.geo.startsWith("unmapped:")).map((r) => ({ geo: r.geo, name: name(r.geo) })).sort((a, b) => (a.geo === "region:WLD" ? -1 : b.geo === "region:WLD" ? 1 : a.name.localeCompare(b.name)));
  return { ...base, candidates, initial: Object.fromEntries(Object.entries(initial).filter(([, p]) => p.length)) };
}
