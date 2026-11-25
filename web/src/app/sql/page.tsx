import { Workbench } from "@/components/sql/Workbench";
import { geoNames, sourceList } from "@/lib/data";
import { IN_STATES } from "@/lib/in-states";
import { isHosted } from "@/lib/mode";
import { tabFromParams } from "@/lib/sql-ai";
import { loadSchema } from "@/lib/sql-schema";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ sql?: string | string[]; run?: string | string[]; mode?: string | string[]; tab?: string | string[] }> }) {
  const sp = await searchParams;
  const sql = typeof sp.sql === "string" ? sp.sql.slice(0, 4000) : "";
  const [{ schema, live }, sources, names] = await Promise.all([loadSchema(), sourceList(), geoNames()]);
  const geos = [...names, ...IN_STATES.map((s) => [s.code, s.name] as const).filter(([c]) => !names.has(c))].map(([code, name]) => ({ code, name }));
  // Ask runs on the server: hosted only when the operator allows a server key.
  const canAsk = !isHosted() || process.env.STATMESH_ALLOW_SERVER_KEY === "1";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Ask a question</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Ask a question about the data. No SQL needed. Prefer SQL? The Advanced tab is read-only DuckDB over statmesh&apos;s views: one SELECT per query, with row and time caps.
      </p>
      <Workbench schema={schema} live={live} canAsk={canAsk} sources={sources.map((s) => s.id)} geos={geos} initialTab={tabFromParams(sp)} initialSql={sql || undefined} runOnMount={!!sql && sp.run === "1"} />
    </>
  );
}
