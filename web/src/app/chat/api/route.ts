import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, tool, type ModelMessage } from "ai";
import { observations } from "@/lib/client";
import { executeShowChart, showChartInput, summarizeChart } from "@/lib/chat/chart";
import { encodeEvent, unwrapToolOutput, type ChatEvent } from "@/lib/chat/events";
import { SYSTEM_PROMPT } from "@/lib/chat/prompt";
import { chartDefaults, scopeParagraph, scopeSchema, withScopeDefaults } from "@/lib/chat/scope";
import { checkBaseUrl } from "@/lib/chat/host-check";
import { describeProviderError, describeToolError } from "@/lib/chat/errors";
import { buildModel, resolveBaseUrl, validateConfig, type ProviderConfig } from "@/lib/chat/providers";

export const dynamic = "force-dynamic";

const mcpUrl = () => (process.env.STATMESH_API_URL ?? "http://localhost:8000").replace(/\/$/, "") + "/mcp";

/**
 * The key arrives in the request body, lives in this function's scope only, is never logged,
 * and is scrubbed from any error text sent back.
 */
export async function POST(req: Request) {
  let body: { config?: Partial<ProviderConfig>; messages?: ModelMessage[]; scope?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const bad = validateConfig(body.config ?? {}) ?? (await checkBaseUrl(resolveBaseUrl(body.config as ProviderConfig)));
  if (bad || !Array.isArray(body.messages) || !body.messages.length) {
    return Response.json({ error: bad ?? "No messages" }, { status: 400 });
  }
  const parsed = scopeSchema.safeParse(body.scope ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid scope" }, { status: 400 });
  const scope = parsed.data;
  const config = body.config as ProviderConfig;
  const key = config.apiKey?.trim();
  const scrub = (m: string) => (key ? m.split(key).join("[key]") : m);

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (e: ChatEvent) => ctrl.enqueue(enc.encode(encodeEvent(e)));
      let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
      try {
        let mcpTools: Record<string, unknown>;
        try {
          client = await createMCPClient({ transport: { type: "http", url: mcpUrl() } });
          mcpTools = await client.tools();
        } catch {
          send({ t: "error", message: "Could not reach the statmesh data API. Check that it is running." });
          return;
        }
        const result = streamText({
          model: buildModel(config),
          instructions: SYSTEM_PROMPT + scopeParagraph(scope),
          messages: body.messages!,
          tools: {
            ...withScopeDefaults(mcpTools, scope),
            // Numbers are fetched here from the API, never supplied by the model.
            show_chart: tool({
              description:
                "Render an interactive chart (line/bar/area) of one or more series in the conversation. Pass series ids found with search_series; the server fetches the data. Use for any trend, comparison or time series.",
              inputSchema: showChartInput,
              execute: (input, { abortSignal }) =>
                executeShowChart(chartDefaults(input, scope), observations, abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)),
              // The client gets the full ChartData via the stream; the model only sees a compact summary.
              toModelOutput: ({ output }) => ({ type: "json", value: summarizeChart(output) }),
            }),
          },
          stopWhen: isStepCount(10),
          maxRetries: 0,
          abortSignal: req.signal,
        });
        for await (const p of result.fullStream) {
          if (p.type === "text-delta") send({ t: "text", text: p.text });
          else if (p.type === "tool-call") send({ t: "call", id: p.toolCallId, name: p.toolName, input: p.input });
          else if (p.type === "tool-result") send({ t: "result", id: p.toolCallId, name: p.toolName, output: unwrapToolOutput(p.output) });
          // A failed tool answers its own call, so the row turns red with the reason instead of staying "running".
          else if (p.type === "tool-error") send({ t: "result", id: p.toolCallId, name: p.toolName, output: { error: scrub(describeToolError(p.error)) } });
          else if (p.type === "error") send({ t: "error", message: scrub(describeProviderError(p.error)) });
        }
      } catch (e) {
        send({ t: "error", message: scrub(describeProviderError(e)) });
      } finally {
        await client?.close().catch(() => {});
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
