import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, type ModelMessage } from "ai";
import { encodeEvent, unwrapToolOutput, type ChatEvent } from "@/lib/chat/events";
import { SYSTEM_PROMPT } from "@/lib/chat/prompt";
import { buildModel, validateConfig, type ProviderConfig } from "@/lib/chat/providers";

export const dynamic = "force-dynamic";

const mcpUrl = () => (process.env.STATMESH_API_URL ?? "http://localhost:8000").replace(/\/$/, "") + "/mcp";

/**
 * The key arrives in the request body, lives in this function's scope only, is never logged,
 * and is scrubbed from any error text sent back.
 */
export async function POST(req: Request) {
  let body: { config?: Partial<ProviderConfig>; messages?: ModelMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const bad = validateConfig(body.config ?? {});
  if (bad || !Array.isArray(body.messages) || !body.messages.length) {
    return Response.json({ error: bad ?? "No messages" }, { status: 400 });
  }
  const config = body.config as ProviderConfig;
  const scrub = (m: string) => (config.apiKey ? m.split(config.apiKey).join("[key]") : m);

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (e: ChatEvent) => ctrl.enqueue(enc.encode(encodeEvent(e)));
      let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
      try {
        client = await createMCPClient({ transport: { type: "http", url: mcpUrl() } });
        const result = streamText({
          model: buildModel(config),
          instructions: SYSTEM_PROMPT,
          messages: body.messages!,
          tools: await client.tools(),
          stopWhen: isStepCount(10),
        });
        for await (const p of result.fullStream) {
          if (p.type === "text-delta") send({ t: "text", text: p.text });
          else if (p.type === "tool-call") send({ t: "call", id: p.toolCallId, name: p.toolName, input: p.input });
          else if (p.type === "tool-result") send({ t: "result", id: p.toolCallId, name: p.toolName, output: unwrapToolOutput(p.output) });
          else if (p.type === "tool-error" || p.type === "error") {
            const err = "error" in p ? p.error : undefined;
            send({ t: "error", message: scrub(err instanceof Error ? err.message : String(err)) });
          }
        }
      } catch (e) {
        send({ t: "error", message: scrub(e instanceof Error ? e.message : String(e)) });
      } finally {
        await client?.close().catch(() => {});
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
