import { loadExpansion, validExpandId } from "@/lib/graph-data";

// Backs the home graph: one expansion (a topic, source, indicator or country node) per request.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("expand") ?? "";
  if (!validExpandId(id)) return Response.json({ error: "Invalid node id" }, { status: 400 });
  const g = await loadExpansion(id);
  if (!g.nodes.length) return Response.json(g);
  return Response.json(g, { headers: { "Cache-Control": "s-maxage=300" } });
}
