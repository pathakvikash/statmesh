import { generateText } from "ai";
import { checkBaseUrl } from "@/lib/chat/host-check";
import { buildModel, cliAllowed, resolveBaseUrl, validateConfig, withServerKey, type ProviderConfig } from "@/lib/chat/providers";
import { localSameOrigin } from "@/lib/chat/same-origin";
import { isHosted } from "@/lib/mode";
import { cleanReply } from "@/lib/sql";
import { loadSchema } from "@/lib/sql-schema";

export const dynamic = "force-dynamic";

/** Writes one SELECT from a question. The schema comes from the server; the key only lives in this request. */
export async function POST(req: Request) {
  const hosted = isHosted();
  // Hosted: no model calls from this server unless the operator opted in (STATMESH_ALLOW_SERVER_KEY=1).
  if (hosted && process.env.STATMESH_ALLOW_SERVER_KEY !== "1") return new Response("Not found", { status: 404 });
  const body = ((await req.json().catch(() => null)) ?? {}) as { config?: Partial<ProviderConfig>; question?: unknown };
  const { question } = body;
  if (typeof question !== "string" || !question.trim()) return Response.json({ error: "Ask a question first." }, { status: 400 });
  if (question.length > 2000) return Response.json({ error: "Question is too long (2000 characters max)." }, { status: 400 });
  const cli = body.config?.kind === "claude-cli";
  if (cli && !cliAllowed(hosted)) return Response.json({ error: "Claude CLI is only available when running statmesh locally." }, { status: 403 });
  if (cli && !localSameOrigin(req)) return Response.json({ error: "Claude CLI only accepts same-origin requests to localhost." }, { status: 403 });
  // A missing browser key falls back to the server's own key (hosted: only with STATMESH_ALLOW_SERVER_KEY=1, checked above).
  const cfg = withServerKey(body.config ?? {}, hosted);
  const bad = validateConfig(cfg) ?? (cli ? null : await checkBaseUrl(resolveBaseUrl(cfg as ProviderConfig)));
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const config = cfg as ProviderConfig;
  const { schema } = await loadSchema();
  const tables = schema.views
    .map((v) => `${v.name}(${v.columns.map((c) => `${c.name} ${c.type}`).join(", ")}) -- ${v.description} Joins: ${v.joins.join("; ")}`)
    .join("\n");
  const instructions = `You write DuckDB SQL for statmesh. Reply with exactly one read-only SELECT statement (WITH is fine) and nothing else: no prose, no code fence. No semicolons, no table functions. Use only these views:\n${tables}`;
  try {
    if (cli) {
      const { generateViaCli } = await import("@/lib/chat/claude-cli");
      return Response.json({ sql: await generateViaCli({ model: config.model, instructions, prompt: question, signal: req.signal }) });
    }
    const { text } = await generateText({ model: buildModel(config), instructions, prompt: question, maxRetries: 0 });
    return Response.json({ sql: cleanReply(text) });
  } catch {
    return Response.json({ error: cli ? "Could not run the claude CLI. Check that it is installed and logged in." : "Could not reach the model provider" }, { status: 502 });
  }
}
