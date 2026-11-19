import { Console } from "./console";

export default function Page() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">SQL console</h1>
      <p className="mb-4 text-sm text-slate-700">
        Read-only: one SELECT statement. Views: observations, series, datasets, sources, geos, geo_groups.
      </p>
      <Console />
    </>
  );
}
