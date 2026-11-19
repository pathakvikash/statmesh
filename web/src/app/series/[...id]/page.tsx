import { notFound } from "next/navigation";
import { Chart } from "@/components/Chart";
import { Citations } from "@/components/Citations";
import { ErrorNote } from "@/components/ErrorNote";
import { Table } from "@/components/Table";
import { ApiError, describe, observations, type ObservationsResult, type SeriesDetail } from "@/lib/client";
import { formatPeriod } from "@/lib/format";

export const dynamic = "force-dynamic";
type P = {
  params: Promise<{ id: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

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
  let obs: ObservationsResult | undefined, error: unknown;
  try {
    obs = await observations(id, { start: sp.start, end: sp.end });
  } catch (e) {
    error = e;
  }
  const c = d.citation;
  return (
    <>
      <h1 className="text-2xl font-bold">{d.title}</h1>
      <p className="mb-4 text-slate-700">{d.description}</p>
      <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Series</dt><dd>{d.series_id}</dd>
        <dt className="font-medium">Unit</dt><dd>{d.unit ?? "n/a"}</dd>
        <dt className="font-medium">Period</dt><dd>{formatPeriod(d.start, d.end)}{d.freq ? ` (${d.freq})` : ""}</dd>
        <dt className="font-medium">Source</dt><dd>{c.source_name} / {c.dataset_id}</dd>
        <dt className="font-medium">Licence</dt><dd><a className="text-blue-800 underline" href={c.licence_url}>{c.licence_name}</a></dd>
        <dt className="font-medium">Geos</dt><dd>{d.geos.join(", ") || "n/a"}</dd>
        <dt className="font-medium">Last updated</dt><dd>{d.last_updated ?? "n/a"}</dd>
        <dt className="font-medium">Last ingested</dt><dd>{d.last_ingested_at ?? "n/a"}</dd>
      </dl>
      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col">Start
          <input type="date" name="start" defaultValue={sp.start} className="rounded border border-slate-400 px-2 py-1" />
        </label>
        <label className="flex flex-col">End
          <input type="date" name="end" defaultValue={sp.end} className="rounded border border-slate-400 px-2 py-1" />
        </label>
        <button className="rounded bg-slate-900 px-4 py-1.5 text-white">Filter</button>
      </form>
      {error ? <ErrorNote error={error} /> : null}
      {obs && obs.status !== "ok" && (
        <p role="alert" className="rounded border border-amber-700 bg-amber-50 p-3 text-amber-900">
          Observations unavailable: {obs.status}
          {obs.retry_after ? `. Retry in about ${Math.ceil(obs.retry_after)} s.` : "."}
        </p>
      )}
      {obs?.status === "ok" && (
        <>
          <h2 className="mb-2 text-lg font-semibold">Chart</h2>
          <Chart columns={obs.columns} rows={obs.rows} unit={d.unit ?? "units not stated"} />
          <h2 className="mb-2 mt-6 text-lg font-semibold">Observations</h2>
          <Table
            columns={obs.columns.filter((x) => ["period_start", "period_end", "geo", "value", "unit", "unit_mult", "obs_status"].includes(x))}
            rows={obs.rows.map((r) => obs.columns.flatMap((x, i) => (["period_start", "period_end", "geo", "value", "unit", "unit_mult", "obs_status"].includes(x) ? [r[i]] : [])))}
            caption={`${obs.rows.length} rows${obs.truncated ? " (truncated)" : ""}. Source: ${c.source_name}.`}
          />
        </>
      )}
      <Citations items={obs?.citations.length ? obs.citations : [c]} />
    </>
  );
}
