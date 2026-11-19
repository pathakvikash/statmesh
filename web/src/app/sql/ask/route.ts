import { generateText } from "ai";
import { checkBaseUrl } from "@/lib/chat/host-check";
import { buildModel, resolveBaseUrl, validateConfig, type ProviderConfig } from "@/lib/chat/providers";
import { loadSchema } from "@/lib/sql-schema";

export const dynamic = "force-dynamic";

/** Writes one SELECT from a question. The schema comes from the server; the key only lives in this request. */
export async function POST(req: Request) {
  const body = ((await req.json().catch(() => null)) ?? {}) as { config?: Partial<ProviderConfig>; question?: unknown };
  const { question } = body;
  if (typeof question !== "string" || !question.trim()) return Response.json({ error: "Ask a question first." }, { status: 400 });
  if (question.length > 2000) return Response.json({ error: "Question is too long (2000 characters max)." }, { status: 400 });
  const bad = validateConfig(body.config ?? {}) ?? (await checkBaseUrl(resolveBaseUrl(body.config as ProviderConfig)));
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const config = body.config as ProviderConfig;
  const { schema } = await loadSchema();
  const tables = schema.views
    .map((v) => `${v.name}(${v.columns.map((c) => `${c.name} ${c.type}`).join(", ")}) -- ${v.description} Joins: ${v.joins.join("; ")}`)
    .join("\n");
  try {
    const { text } = await generateText({
      model: buildModel(config),
      instructions: `You write DuckDB SQL for statmesh. Reply with exactly one read-only SELECT statement (WITH is fine) and nothing else: no prose, no code fence. No semicolons, no table functions. Use only these views:\n${tables}`,
      prompt: question,
      maxRetries: 0,
    });
    return Response.json({ sql: text.replace(/^```\w*\n?|```\s*$/g, "").trim() });
  } catch {
    return Response.json({ error: "Could not reach the model provider" }, { status: 502 });
  }
}
