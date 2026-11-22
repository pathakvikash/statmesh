import Link from "next/link";
import { notFound } from "next/navigation";
import { AskAiButton } from "@/components/AskAiButton";
import { ErrorNote } from "@/components/ErrorNote";
import { MiniBars, ResultCard } from "@/components/SeriesCards";
import { keyState } from "@/components/SourceCard";
import type { SeriesHit } from "@/lib/client";
import { allSources, findSeries, geoName, geoNames, hitStats, sourceDatasets } from "@/lib/data";
import { REDIST_LABELS, freqLabel, kindLabel, relativeTime, shortSourceName } from "@/lib/format";
import { isHosted } from "@/lib/mode";
import { searchHref } from "@/lib/params";
import { card } from "@/lib/ui";

export const dynamic = "force-dynamic";

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const Cite = ({ children }: { children: React.ReactNode }) => <p className="mt-1 text-xs text-muted-foreground">Source: {children}</p>;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decode((await params).id);
  const s = await allSources().then((a) => a.find((x) => x.id === id)).catch(() => undefined);
  return { title: s ? shortSourceName(s.name) : "Source" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = decode((await params).id);
  let src;
  try {
    src = (await allSources()).find((s) => s.id === id);
  } catch (e) {
    return <ErrorNote error={e} />;
  }
  if (!src) notFound();
  const name = shortSourceName(src.name);
  const hosted = isHosted();
  const [datasets, names, hits] = await Promise.all([
    sourceDatasets(id), geoNames(), findSeries({ q: "", source: [id], topic: [] }).then((h) => h.slice(0, 12), () => [] as SeriesHit[]),
  ]);
  const stats = await hitStats(hits.map((h) => h.series_id));
  const largest = datasets.filter((d) => d.series > 0).slice(0, 8);
  const titles = new Map(datasets.map((d) => [d.id, d.title]));
  const withData = hosted ? " with data here" : "";
  const catalogue = "statmesh catalogue (sources API)";
  return (
    <div className="space-y-10">
      <header className="relative">
        <p className="text-sm"><Link href="/sources" className="text-accent hover:underline">Sources</Link></p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
            <p className="text-sm text-muted-foreground">{src.name}</p>
          </div>
          <AskAiButton target={{ kind: "source", id, name: src.name }} label="Ask AI about this source" />
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <li>{kindLabel(src.kind)}</li>
          <li>{keyState(src)}</li>
          <li>{REDIST_LABELS[src.redistribute] ?? src.redistribute}</li>
          <li>{src.last_ingested_at ? `Updated ${relativeTime(src.last_ingested_at)}` : "Never ingested"}</li>
          {!src.enabled && <li className="font-medium">Disabled</li>}
        </ul>
      </header>

      <section aria-label="Key figures">
        <dl className="grid grid-cols-3 gap-3">
          {[["Series", src.series], ["Datasets", src.datasets], ["Stale datasets", src.stale_datasets]].map(([k, v]) => (
            <div key={k} className={`${card} p-4`}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{Number(v).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <Cite>{catalogue}</Cite>
      </section>

      {src.series === 0 ? (
        <div className={`${card} p-6`}>
          <p className="font-medium">No series ingested yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Load this source with <code className="rounded bg-muted px-1">statmesh ingest {id}</code>, then reload this page.</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="ds">
            <h2 id="ds" className="mb-3 text-xl font-semibold tracking-tight">Largest datasets</h2>
            {datasets.length === 0 ? <p className="text-sm text-muted-foreground">No dataset details available.</p> : (
              <div className={`${card} space-y-4 p-4`}>
                {largest.length > 0 && <MiniBars bars={largest.map((d) => ({ geo: d.id, v: d.series }))} names={titles} unit={`series${withData}`} />}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Datasets of {name}</caption>
                    <thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3 font-medium">Dataset</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 pr-3 font-medium">Frequency</th><th className="py-1 text-right font-medium">Series{withData}</th></tr></thead>
                    <tbody>
                      {datasets.map((d) => (
                        <tr key={d.id} className="border-t border-border">
                          <td className="max-w-[16rem] truncate py-1.5 pr-3" title={d.title}>{d.title}</td>
                          <td className="py-1.5 pr-3">{d.status ?? ""}</td>
                          <td className="py-1.5 pr-3">{freqLabel(d.freq) ?? ""}</td>
                          <td className="py-1.5 text-right tabular-nums">{d.series.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <Cite>statmesh catalogue (datasets and series tables, via SQL){hosted ? "; counts cover only series with data in this hosted instance" : ""}</Cite>
          </section>

          <section aria-labelledby="ser">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2 id="ser" className="text-xl font-semibold tracking-tight">Series with data</h2>
              <Link href={searchHref({ source: id })} className="text-sm text-accent hover:underline">Search within {name}</Link>
            </div>
            {hits.length === 0 ? <p className="text-sm text-muted-foreground">No series to show yet. Ingest this source to see charts here.</p> : (
              <div className="space-y-3">
                {hits.map((h) => <ResultCard key={h.series_id} h={h} stat={stats[h.series_id]} source={name} geo={geoName(names, h.geo)} names={names} liveOk={!hosted} />)}
              </div>
            )}
            <Cite>{name} via the statmesh search API; values from statmesh observations</Cite>
          </section>
        </>
      )}
    </div>
  );
}
