import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, tool, type ModelMessage } from "ai";
import { observations } from "@/lib/client";
import { cleanChartInput, executeShowChart, showChartInput, summarizeChart, type ChartData } from "@/lib/chat/chart";
import { encodeEvent, unwrapToolOutput, type ChatEvent } from "@/lib/chat/events";
import { SYSTEM_PROMPT, pageContextParagraph } from "@/lib/chat/prompt";
import { parsePageContext } from "@/lib/ai-context";
import { chartDefaults, scopeParagraph, scopeSchema, withScopeDefaults } from "@/lib/chat/scope";
import { checkBaseUrl } from "@/lib/chat/host-check";
import { describeProviderError, describeToolError } from "@/lib/chat/errors";
import { leanForModel, restoreFull } from "@/lib/chat/trim";
import { localSameOrigin } from "@/lib/chat/same-origin";
import { isHosted } from "@/lib/mode";
import { buildModel, cliAllowed, resolveBaseUrl, validateConfig, withServerKey, type ProviderConfig } from "@/lib/chat/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; raise on plans that allow longer streams

const mcpUrl = () => (process.env.STATMESH_API_URL ?? "http://localhost:8000").replace(/\/$/, "") + "/mcp";

/**
 * The key arrives in the request body, lives in this function's scope only, is never logged,
 * and is scrubbed from any error text sent back.
 */
export async function POST(req: Request) {
  let body: { config?: Partial<ProviderConfig>; messages?: ModelMessage[]; scope?: unknown; pageContext?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cli = body.config?.kind === "claude-cli";
  if (cli && !cliAllowed(isHosted())) return Response.json({ error: "Claude CLI is only available when running statmesh locally." }, { status: 403 });
  // The CLI spends the user's plan: only a same-origin browser request to a loopback host may start it.
  if (cli && !localSameOrigin(req)) return Response.json({ error: "Claude CLI only accepts same-origin requests to localhost." }, { status: 403 });
  // A missing browser key falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY on this server (hosted: only with STATMESH_ALLOW_SERVER_KEY=1).
  const cfg = withServerKey(body.config ?? {}, isHosted());
  const bad = validateConfig(cfg) ?? (cli ? null : await checkBaseUrl(resolveBaseUrl(cfg as ProviderConfig)));
  if (bad || !Array.isArray(body.messages) || !body.messages.length) {
    return Response.json({ error: bad ?? "No messages" }, { status: 400 });
  }
  const parsed = scopeSchema.safeParse(body.scope ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid scope" }, { status: 400 });
  const scope = parsed.data;
  const page = parsePageContext(body.pageContext);
  if (!page.ok) return Response.json({ error: page.error }, { status: 400 });
  const config = cfg as ProviderConfig;
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
        // CLI path: toModelOutput is lost through MCP, so execute keeps the full chart here and the model gets
        // the summary plus a chartRef; the stream loop swaps the chart back in for the UI.
        const charts = new Map<string, ChartData>();
        const fulls = new Map<string, unknown>();
        const tools = {
          ...leanForModel(withScopeDefaults(mcpTools, scope), cli, fulls),
          // Numbers are fetched here from the API, never supplied by the model.
          show_chart: tool({
            description:
              "Render an interactive chart (line/bar/area) of one or more series in the conversation. Pass series ids found with search_series; the server fetches the data. Use for any trend, comparison or time series.",
            inputSchema: showChartInput,
            execute: async (input, { abortSignal }) => {
              const d = await executeShowChart(chartDefaults(cleanChartInput(input), scope), observations, abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000));
              if (!cli) return d;
              const chartRef = crypto.randomUUID();
              charts.set(chartRef, d);
              return { ...summarizeChart(d), chartRef } as unknown as ChartData;
            },
            // The client gets the full ChartData via the stream; the model only sees a compact summary.
            toModelOutput: ({ output }) => ({ type: "json", value: cli ? output : summarizeChart(output) }) as never,
          }),
        };
        const instructions = SYSTEM_PROMPT + scopeParagraph(scope) + pageContextParagraph(page.value);
        const result = cli
          ? (await import("@/lib/chat/claude-cli")).streamViaCli({ model: config.model, instructions, messages: body.messages!, tools, signal: req.signal })
          : streamText({
              model: buildModel(config),
              instructions,
              messages: body.messages!,
              tools,
              stopWhen: isStepCount(10),
              maxRetries: 0,
              abortSignal: req.signal,
            });
        const nameOf = (n: string) => (cli ? n.replace(/^mcp__statmesh__/, "") : n);
        for await (const p of result.fullStream) {
          if (p.type === "text-delta") send({ t: "text", text: p.text });
          else if (p.type === "tool-call") send({ t: "call", id: p.toolCallId, name: nameOf(p.toolName), input: p.input });
          else if (p.type === "tool-result") {
            const name = nameOf(p.toolName);
            const raw = p.output as unknown;
            let output: unknown = unwrapToolOutput(raw);
            const ref = (output as { chartRef?: unknown } | null)?.chartRef;
            if (name === "show_chart" && typeof ref === "string" && charts.has(ref)) output = charts.get(ref);
            output = restoreFull(output, fulls);
            send({ t: "result", id: p.toolCallId, name, output });
          }
          // A failed tool answers its own call, so the row turns red with the reason instead of staying "running".
          else if (p.type === "tool-error") send({ t: "result", id: p.toolCallId, name: nameOf(p.toolName), output: { error: scrub(describeToolError(p.error)) } });
          else if (p.type === "error") send({ t: "error", message: scrub(cli ? (await import("@/lib/chat/claude-cli")).describeCliError(p.error) : describeProviderError(p.error)) });
        }
      } catch (e) {
        send({ t: "error", message: scrub(cli ? (await import("@/lib/chat/claude-cli")).describeCliError(e) : describeProviderError(e)) });
      } finally {
        await client?.close().catch(() => {});
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
