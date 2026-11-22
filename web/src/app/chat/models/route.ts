import { isHosted } from "@/lib/mode";
import { cliAllowed, serverKeyFor } from "@/lib/chat/providers";
import { claudeFound } from "@/lib/chat/claude-bin";
import { listModels } from "@/lib/chat/model-list";

export const dynamic = "force-dynamic";

/** POST, not GET, so the API key travels in the body and never in a URL. Body: { config }. */
export async function POST(req: Request) {
  let body: { config?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const r = await listModels(body.config);
  return r.ok
    ? Response.json({ models: r.models }, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
}

/** Reports (never returns) which providers have a key in the web server's environment. */
export async function GET() {
  const has = (k: "anthropic" | "openai") => !!serverKeyFor(k, isHosted());
  return Response.json({ serverKey: { anthropic: has("anthropic"), openai: has("openai") }, cli: cliAllowed(isHosted()) && (await claudeFound()) }, { headers: { "cache-control": "no-store" } });
}
