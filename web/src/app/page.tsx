import Link from "next/link";
import { ErrorNote } from "@/components/ErrorNote";
import { search, type SearchResult } from "@/lib/client";
import { formatPeriod, seriesHref } from "@/lib/format";

export const dynamic = "force-dynamic";
type P = { searchParams: Promise<Record<string, string | undefined>> };

const input = "rounded border border-slate-400 px-2 py-1";

export default async function Page({ searchParams }: P) {
  const sp = await searchParams;
  const q = sp.q ?? "";
  let res: SearchResult | undefined, error: unknown;
  if (q) {
    try {
      res = await search({ q, geo: sp.geo, freq: sp.freq, source: sp.source });
    } catch (e) {
      error = e;
    }
  }
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Search series</h1>
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <label className="flex flex-col text-sm">Query
          <input name="q" defaultValue={q} required className={input} />
        </label>
        <label className="flex flex-col text-sm">Geo
          <input name="geo" defaultValue={sp.geo} placeholder="IND" className={`${input} w-24`} />
        </label>
        <label className="flex flex-col text-sm">Frequency
          <select name="freq" defaultValue={sp.freq ?? ""} className={input}>
            <option value="">any</option>
            {["A", "S", "Q", "M", "W", "D"].map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">Source
          <input name="source" defaultValue={sp.source} placeholder="worldbank" className={`${input} w-32`} />
        </label>
        <button className="rounded bg-slate-900 px-4 py-1.5 text-white">Search</button>
      </form>
      {error ? <ErrorNote error={error} /> : null}
      {res && (res.hits.length === 0 ? <p>No series found for &ldquo;{res.query}&rdquo;.</p> : (
        <ul className="divide-y divide-slate-200">
          {res.hits.map((h) => (
            <li key={h.series_id} className="py-3">
              <Link href={seriesHref(h.series_id)} className="font-medium text-blue-800 underline">{h.title}</Link>
              <p className="text-sm text-slate-700">
                Unit: {h.unit ?? "n/a"} · Period: {formatPeriod(h.start, h.end)}
                {h.freq ? ` (${h.freq})` : ""} · Geo: {h.geo ?? "multiple"} · Source: {h.source_id}/{h.dataset_id} ·
                Licence: {h.licence_name}
              </p>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}
