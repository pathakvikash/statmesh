// Local-only chat through the user's logged-in `claude` CLI (their own plan, no API key). The route
// refuses this when hosted (cliAllowed), and imports this module only on that branch.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText, streamText, type ModelMessage } from "ai";
import { claudeCode, createAiSdkMcpServer } from "ai-sdk-provider-claude-code";
import { z } from "zod";
import { cleanReply } from "../sql";
import { unwrapToolOutput } from "./events";

const SERVER = "statmesh";
const PREFIX = `mcp__${SERVER}__`;
export const stripPrefix = (name: string) => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);

/**
 * Hardened options: no built-in tools, no user/project settings, hooks, plugins or CLAUDE.md, only the
 * bridged statmesh MCP server, a throwaway cwd. The API-billing env vars are removed so the plan's OAuth
 * login is used. Never add --bare: it skips the OAuth login.
 */
export function cliOptions(mcpServers: Record<string, unknown> = {}) {
  const env: Record<string, string | undefined> = { ...process.env };
  // The provider re-adds ANTHROPIC_*/CLAUDE_*/cloud vars from process.env under the settings env, so deleting
  // is not enough: an explicit undefined overrides them and spawn skips it.
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) env[k] = undefined;
  return {
    tools: [] as string[],
    allowedTools: [`${PREFIX}*`],
    // The provider warns that allowedTools wins when both are set; what really confines the CLI is
    // tools: [] (no built-ins) + allowedTools + permissionMode "dontAsk". Kept as a second net.
    disallowedTools: ["Bash", "Edit", "Write", "Read", "WebFetch", "WebSearch", "Task", "NotebookEdit"],
    permissionMode: "dontAsk" as const,
    settingSources: [] as ("user" | "project" | "local")[],
    mcpServers: mcpServers as never,
    strictMcpConfig: true,
    cwd: mkdtempSync(join(tmpdir(), "statmesh-cli-")),
    maxTurns: 10,
    persistSession: false,
    env,
    pathToClaudeCodeExecutable: process.env.STATMESH_CLAUDE_BIN || (process.platform === "win32" ? "claude.exe" : "claude"),
  };
}

const CONSTRAINTS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "format", "pattern", "minLength", "maxLength", "minItems", "maxItems", "default"];
type Json = Record<string, unknown>;

/**
 * Loosens a tool's JSON Schema so zod never rejects what the real tool accepts: the MCP server (pydantic)
 * coerces "5" to 5 and checks ranges itself, and a model often sends null for an optional it skips. So numbers
 * also accept strings, constraints are dropped, and every optional property accepts null (execute drops it).
 * The real MCP tool still validates and its error text goes back to the model.
 */
export function loosen(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(loosen);
  if (!s || typeof s !== "object") return s;
  const o: Json = { ...(s as Json) };
  for (const k of CONSTRAINTS) delete o[k]; // "default": the real tool applies its own, and zod would demand the key
  // Children first, then this node: the anyOf added below must not be walked again.
  for (const k of ["items", "additionalProperties", "anyOf", "oneOf", "allOf"]) if (k in o) o[k] = loosen(o[k]);
  if (o.type === "integer" || o.type === "number") {
    delete o.type;
    o.anyOf = [{ type: "number" }, { type: "string" }];
  }
  if (o.properties && typeof o.properties === "object") {
    const required = new Set(Array.isArray(o.required) ? (o.required as string[]) : []);
    o.properties = Object.fromEntries(
      Object.entries(o.properties as Json).map(([k, v]) => {
        const p = loosen(v) as Json;
        const nullable = Array.isArray(p.anyOf) && (p.anyOf as Json[]).some((x) => x.type === "null");
        return [k, required.has(k) || nullable ? p : { anyOf: [p, { type: "null" }] }];
      }),
    );
  }
  return o;
}

/** Null means "not given": the real tool's defaults apply. */
const dropNulls = (i: unknown) =>
  i && typeof i === "object" && !Array.isArray(i) ? Object.fromEntries(Object.entries(i).filter(([, v]) => v !== null)) : i;

type AnyTool = { description?: unknown; inputSchema?: unknown; execute?: (input: never, opts: never) => unknown };

/**
 * createAiSdkMcpServer wants zod object schemas, but tools from the MCP client carry JSON Schema:
 * convert those, and unwrap the MCP result envelope so the model sees the payload.
 */
export function bridge(tools: Record<string, unknown>): Record<string, AnyTool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const tool = t as AnyTool;
      const js = (tool.inputSchema as { jsonSchema?: unknown } | undefined)?.jsonSchema;
      let schema = tool.inputSchema;
      if (js) {
        try {
          const z4 = z.fromJSONSchema(loosen(js) as never) as unknown as { shape?: unknown };
          schema = z4.shape ? z4 : z.object({}).passthrough();
        } catch (e) {
          // An empty shape makes the Agent SDK advertise {} and strip every argument, so say so.
          console.warn(`statmesh claude-cli: could not convert the input schema of tool "${name}" (${e instanceof Error ? e.message : "error"}); it will run without arguments`);
          schema = z.object({}).passthrough();
        }
      }
      const run = tool.execute;
      return [name, { description: tool.description, inputSchema: schema, execute: run && (async (i: never, o: never) => unwrapToolOutput(await run(dropNulls(i) as never, o))) }];
    }),
  );
}

/** Maps the provider's failures to messages a user can act on. */
export function describeCliError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string } | null)?.code;
  if (code === "ENOENT" || /ENOENT|not found/i.test(m))
    return "Claude CLI not found. Install Claude Code, run `claude` once to log in, or set STATMESH_CLAUDE_BIN.";
  if (/auth|login|log in|401|oauth/i.test(m)) return "The claude CLI is not logged in. Run `claude` and log in.";
  return m;
}

export function streamViaCli(o: {
  model: string;
  instructions: string;
  messages: ModelMessage[];
  tools: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const opts = cliOptions({ [SERVER]: createAiSdkMcpServer(SERVER, bridge(o.tools) as never) });
  const cleanup = () => rmSync(opts.cwd, { recursive: true, force: true });
  return streamText({
    model: claudeCode(o.model, opts),
    instructions: o.instructions,
    messages: o.messages,
    maxRetries: 0,
    abortSignal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    onFinish: cleanup,
    onError: cleanup,
    onAbort: cleanup,
  });
}

/** One-shot text through the CLI (the SQL workbench's Ask): same hardening as chat, no MCP servers, throwaway cwd. */
export async function generateViaCli(o: { model: string; instructions: string; prompt: string; signal?: AbortSignal }): Promise<string> {
  const opts = cliOptions();
  try {
    const { text } = await generateText({
      model: claudeCode(o.model, opts),
      instructions: o.instructions,
      prompt: o.prompt,
      maxRetries: 0,
      abortSignal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    return cleanReply(text);
  } finally {
    rmSync(opts.cwd, { recursive: true, force: true });
  }
}
