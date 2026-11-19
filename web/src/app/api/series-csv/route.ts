import { observations } from "@/lib/client";
import { toCsv } from "@/lib/sql-csv";

// GET /api/series-csv?id=<series_id> -> observations as CSV.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return new Response("missing id", { status: 400 });
  try {
    const o = await observations(id);
    if (o.status !== "ok") return new Response(`observations ${o.status}`, { status: o.status === "not_found" ? 404 : 502 });
    const csv = toCsv(o.columns, o.rows);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${id.replace(/[^\w.-]+/g, "_")}.csv"`,
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 502 });
  }
}
