import { apiFetch } from "@/lib/client";

// Same-origin proxy so the SQL console (browser) never calls the API directly.
export async function POST(req: Request) {
  try {
    const r = await apiFetch("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.text(),
    });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return Response.json({ detail: (e as Error).message }, { status: 502 });
  }
}
