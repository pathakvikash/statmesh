import { Workbench } from "@/components/sql/Workbench";
import { isHosted } from "@/lib/mode";
import { loadSchema } from "@/lib/sql-schema";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { schema, live } = await loadSchema();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">SQL workbench</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Read-only DuckDB SQL over statmesh&apos;s views: one SELECT per query, with row and time caps.
      </p>
      <Workbench schema={schema} live={live} canAsk={!isHosted()} />
    </>
  );
}
