import { createMCPClient } from "@ai-sdk/mcp";
import { isStepCount, streamText, tool, type ModelMessage } from "ai";
import { observations, sql } from "@/lib/client";
import { cleanChartInput, executeShowChart, showChartInput, summarizeChart, type ChartData } from "@/lib/chat/chart";
import { encodeEvent, unwrapToolOutput, type ChatEvent } from "@/lib/chat/events";
import { SYSTEM_PROMPT, pageContextParagraph } from "@/lib/chat/prompt";
import { parsePageContext } from "@/lib/ai-context";
import { chartDefaults, scopeParagraph, scopeSchema, withScopeDefaults } from "@/lib/chat/scope";
import { checkBaseUrl } from "@/lib/chat/host-check";
import { describeProviderError, describeToolError } from "@/lib/chat/errors";
import { sqlDataLayer, withHasData } from "@/lib/chat/suggest-check";
import { leanForModel, restoreFull } from "@/lib/chat/trim";
import { localSameOrigin } from "@/lib/chat/same-origin";
import { isHosted } from "@/lib/mode";
import { FREE_MAX_INPUT_TOKENS, FREE_MAX_STEPS, FREE_PROMPT, clientIp, estimateTokens, freeProviders, quotaPayload, refundTurn, startWithFallback, takeTurn, trimHistory, unavailablePayload } from "@/lib/chat/free";
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
  const free = body.config?.kind === "free";
  const cli = body.config?.kind === "claude-cli";
  if (cli && !cliAllowed(isHosted())) return Response.json({ error: "Claude CLI is only available when running statmesh locally." }, { status: 403 });
  // The CLI spends the user's plan: only a same-origin browser request to a loopback host may start it.
  if (cli && !localSameOrigin(req)) return Response.json({ error: "Claude CLI only accepts same-origin requests to localhost." }, { status: 403 });
  // A missing browser key falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY on this server (hosted: only with STATMESH_ALLOW_SERVER_KEY=1).
  // Kind "free" ignores everything the browser sent: URL, key and model come from the server env only.
  const providers = free ? freeProviders() : [];
  if (free && !providers.length) return Response.json({ error: "The free assistant is not available." }, { status: 403, headers: { "cache-control": "no-store" } });
  const cfg = free ? providers[0] : withServerKey(body.config ?? {}, isHosted());
  const bad = validateConfig(cfg) ?? (cli || free ? null : await checkBaseUrl(resolveBaseUrl(cfg as ProviderConfig)));
  if (bad || !Array.isArray(body.messages) || !body.messages.length) {
    return Response.json({ error: bad ?? "No messages" }, { status: 400 });
  }
  const parsed = scopeSchema.safeParse(body.scope ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid scope" }, { status: 400 });
  const scope = parsed.data;
  const page = parsePageContext(body.pageContext);
  if (!page.ok) return Response.json({ error: page.error }, { status: 400 });
  const config = cfg as ProviderConfig;
  const keys = (free ? providers : [config]).map((p) => p.apiKey?.trim()).filter(Boolean);
  const scrub = (m: string) => keys.reduce((t, k) => t.split(k).join("[key]"), m);
  const nd = (e: ChatEvent) => new Response(encodeEvent(e), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
  const messages = free ? trimHistory(body.messages) : body.messages;
  const instructions = SYSTEM_PROMPT + scopeParagraph(scope) + pageContextParagraph(page.value) + (free ? FREE_PROMPT : "");
  const ip = free ? clientIp(req) : "";
  const at = Date.now();
  let refunded = false;
  // A turn that produced no output costs the visitor nothing (best effort, once).
  const refund = () => {
    if (!free || refunded) return;
    refunded = true;
    void refundTurn(ip, { now: at });
  };
  if (free) {
    if (estimateTokens(messages, instructions) > FREE_MAX_INPUT_TOKENS)
      return Response.json({ code: "free_input_too_long", error: "That question and its history are too long for the free assistant. Shorten it or start a new chat." }, { status: 413, headers: { "cache-control": "no-store" } });
    // One user turn = one count, however many model calls and tool steps it makes.
    const over = await takeTurn(ip, { now: at });
    if (over) return Response.json(over, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(Math.max(1, Math.ceil((Date.parse(over.resetAt) - Date.now()) / 1000))) } });
  }

  let client: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  let mcpTools: Record<string, unknown>;
  try {
    client = await createMCPClient({ transport: { type: "http", url: mcpUrl() } });
    mcpTools = await client.tools();
  } catch {
    await client?.close().catch(() => {});
    refund();
    return nd({ t: "error", message: "Could not reach the statmesh data API. Check that it is running." });
  }
  // CLI path: toModelOutput is lost through MCP, so execute keeps the full chart here and the model gets
  // the summary plus a chartRef; the stream loop swaps the chart back in for the UI.
  const charts = new Map<string, ChartData>();
  const fulls = new Map<string, unknown>();
  const tools = {
    ...leanForModel(withHasData(withScopeDefaults(mcpTools, scope), sqlDataLayer(sql)), cli, fulls),
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
  const noStore = { "cache-control": "no-store" };
  const unavailable = () => Response.json(unavailablePayload(), { status: 503, headers: noStore });
  const busy = () => Response.json(quotaPayload(new Date(Date.now() + 60_000), "The free assistant is busy right now."), { status: 429, headers: { ...noStore, "retry-after": "60" } });
  let freeFail: Response | undefined;
  let source: AsyncIterable<any> | undefined;
  try {
    if (cli) source = (await import("@/lib/chat/claude-cli")).streamViaCli({ model: config.model, instructions, messages, tools, signal: req.signal }).fullStream;
    else if (free) {
      // Primary, then the fallback before any output. Limit hits (429/5xx) on both = busy; anything else (bad key, 400,
      // network) = unavailable. Server log: provider host and status only, never keys, prompts or provider bodies.
      const r = await startWithFallback(
        providers.length,
        (i) => streamText({ model: buildModel(providers[i]), instructions, messages, tools, stopWhen: isStepCount(FREE_MAX_STEPS), maxRetries: 0, abortSignal: req.signal }),
        (i, status) => console.error("free assistant provider failed", { provider: new URL(providers[i].baseUrl).hostname, status }),
      );
      if (r.ok) source = r.stream;
      else freeFail = r.kind === "quota" ? busy() : unavailable();
    } else source = streamText({ model: buildModel(config), instructions, messages, tools, stopWhen: isStepCount(10), maxRetries: 0, abortSignal: req.signal }).fullStream;
  } catch (e) {
    await client.close().catch(() => {});
    if (free) {
      refund();
      return unavailable();
    }
    return nd({ t: "error", message: scrub(cli ? (await import("@/lib/chat/claude-cli")).describeCliError(e) : describeProviderError(e)) });
  }
  if (freeFail || !source) {
    await client.close().catch(() => {});
    refund();
    return freeFail!;
  }
  const run = source;
  // The free provider's own errors (a rejected key, say) are not the visitor's to fix or to read.
  const errText = async (e: unknown) =>
    free ? "The free assistant had a problem. Try again, or add your own API key in Settings." : scrub(cli ? (await import("@/lib/chat/claude-cli")).describeCliError(e) : describeProviderError(e));

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const enc = new TextEncoder();
      let sent = false;
      const send = (e: ChatEvent) => {
        if (e.t !== "error") sent = true;
        ctrl.enqueue(enc.encode(encodeEvent(e)));
      };
      try {
        const nameOf = (n: string) => (cli ? n.replace(/^mcp__statmesh__/, "") : n);
        for await (const p of run) {
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
          else if (p.type === "error") send({ t: "error", message: await errText(p.error) });
        }
      } catch (e) {
        send({ t: "error", message: await errText(e) });
      } finally {
        if (!sent && req.signal.aborted) refund();
        await client?.close().catch(() => {});
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
