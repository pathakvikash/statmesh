import { parseCountryParam, parseSexParam } from "@/lib/country-drill";
import { loadDrill } from "@/lib/country-drill-data";

// GET /api/country-drill?id=<3-part key>&c=IND&sex=male|female|all&dim.x=v: heavy lookups stay on the server, the client gets plain JSON.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const key = (q.get("id") ?? "").split(":").slice(0, 3).join(":");
  const geo = parseCountryParam(q.get("c"));
  if (key.split(":").length !== 3 || !geo) return Response.json({ detail: "id (source:dataset:indicator) and c are required" }, { status: 400 });
  const dims = Object.fromEntries([...q.entries()].filter(([k, v]) => k.startsWith("dim.") && v).map(([k, v]) => [k.slice(4), v]));
  try {
    const data = await loadDrill(key, geo, parseSexParam(q.get("sex")), dims);
    // Cache only results with data; empty results and errors stay uncached.
    const headers = data.points.length ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : undefined;
    return Response.json(data, { headers });
  } catch {
    return Response.json({ detail: "Upstream data unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
