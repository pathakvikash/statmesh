import { ErrorNote } from "@/components/ErrorNote";
import { sources, type SourceStatus } from "@/lib/client";

export const dynamic = "force-dynamic";

export default async function Page() {
  let rows: SourceStatus[];
  try {
    rows = await sources();
  } catch (e) {
    return <ErrorNote error={e} />;
  }
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Sources</h1>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {["Source", "Enabled", "Auth", "API key", "Datasets", "Series", "Last ingested", "Stale datasets", "Redistribute"].map((h) => (
                <th key={h} scope="col" className="border-b border-slate-400 px-2 py-1">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="odd:bg-slate-50">
                <th scope="row" className="px-2 py-1 font-medium">{s.name} <span className="font-normal text-slate-600">({s.id})</span></th>
                <td className="px-2 py-1">{s.enabled ? "yes" : "no"}</td>
                <td className="px-2 py-1">{s.auth}</td>
                <td className="px-2 py-1">{s.auth === "none" ? "not needed" : s.key_configured ? "configured" : "missing"}</td>
                <td className="px-2 py-1 tabular-nums">{s.datasets} datasets</td>
                <td className="px-2 py-1 tabular-nums">{s.series} series</td>
                <td className="px-2 py-1">{s.last_ingested_at?.slice(0, 16).replace("T", " ") ?? "never"}</td>
                <td className="px-2 py-1 tabular-nums">{s.stale_datasets} stale</td>
                <td className="px-2 py-1">{s.redistribute}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
