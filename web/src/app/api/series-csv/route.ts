import { apiFetch } from "../../../lib/client";

// GET /api/series-csv?id=<series_id> -> the API's streamed observations.csv, passed through unbuffered.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return new Response("missing id", { status: 400 });
  try {
    const path = id.split("/").map(encodeURIComponent).join("/");
    const r = await apiFetch(`/series/${path}/observations.csv`, { signal: req.signal });
    if (!r.ok || !r.body) {
      const body = await r.json().catch(() => ({}));
      const status = body.status ?? body.detail ?? r.statusText;
      return new Response(`observations ${status}`, { status: r.status === 404 || r.status === 403 || r.status === 429 ? r.status : 502 });
    }
    const headers: Record<string, string> = {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${id.replace(/[^\w.-]+/g, "_")}.csv"`,
    };
    const attr = r.headers.get("x-statmesh-attribution");
    if (attr) headers["x-statmesh-attribution"] = attr;
    const cap = r.headers.get("x-statmesh-row-cap");
    if (cap) headers["x-statmesh-row-cap"] = cap;
    return new Response(r.body, { headers });
  } catch (e) {
    return new Response((e as Error).message, { status: 502 });
  }
}
