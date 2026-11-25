import { allow, buildFacts } from "@/lib/chat/browser-context";

// GET /api/chat/context?q=...: top series (id, title, source, citation URL, latest value, unit, period) for the on-device assistant.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return Response.json({ detail: "q is required" }, { status: 400 });
  if (!(await allow(req))) return Response.json({ detail: "Too many requests" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  try {
    const facts = await buildFacts(q);
    return Response.json({ facts }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return Response.json({ detail: "Upstream data unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
