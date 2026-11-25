import { search } from "@/lib/client";
import { geoName, geoNames } from "@/lib/data";
import { freqLabel } from "@/lib/format";

// Backs the ⌘K palette: top series for a short query.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  if (q.length < 2) return Response.json([]);
  try {
    const [res, names] = await Promise.all([search({ q }), geoNames()]);
    return Response.json(res.hits.slice(0, 8).map((h) => ({
      id: h.series_id,
      title: h.title,
      geo: h.geo,
      freq: h.freq,
      meta: [h.source_id, geoName(names, h.geo), freqLabel(h.freq)].filter(Boolean).join(" · "),
    })));
  } catch {
    return Response.json([]);
  }
}
