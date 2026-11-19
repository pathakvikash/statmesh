import { apiFetch, ApiError } from "@/lib/client";

// POST /api/share: forwards the share payload to the API's POST /shares and returns its status and body.
export async function POST(req: Request) {
  try {
    const r = await apiFetch("/shares", { method: "POST", headers: { "content-type": "application/json" }, body: await req.text() });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ detail: (e as Error).message }, { status: e instanceof ApiError ? e.status : 502 });
  }
}
