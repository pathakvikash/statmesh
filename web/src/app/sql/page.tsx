import { Workbench } from "@/components/sql/Workbench";
import { isHosted } from "@/lib/mode";
import { loadSchema } from "@/lib/sql-schema";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ sql?: string | string[]; run?: string | string[] }> }) {
  const sp = await searchParams;
  const sql = typeof sp.sql === "string" ? sp.sql.slice(0, 4000) : "";
  const { schema, live } = await loadSchema();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">SQL workbench</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Read-only DuckDB SQL over statmesh&apos;s views: one SELECT per query, with row and time caps.
      </p>
      <Workbench schema={schema} live={live} canAsk={!isHosted()} initialSql={sql || undefined} runOnMount={!!sql && sp.run === "1"} />
    </>
  );
}
