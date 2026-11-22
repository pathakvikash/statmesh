import { afterEach, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { jsonSchema, tool } from "ai";
import { createAiSdkMcpServer } from "ai-sdk-provider-claude-code";
import { z } from "zod";
import { showChartInput } from "./chart";
import { bridge, cliOptions, loosen, describeCliError, streamViaCli, stripPrefix } from "./claude-cli";

afterEach(() => vi.unstubAllEnvs());

it("strips only the statmesh MCP prefix", () => {
  expect(stripPrefix("mcp__statmesh__search_series")).toBe("search_series");
  expect(stripPrefix("search_series")).toBe("search_series");
  expect(stripPrefix("mcp__other__x")).toBe("mcp__other__x");
});

it("is hardened: no built-in tools, no settings, no API-billing env, no --bare", () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "t");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://x.example");
  const o = cliOptions();
  rmSync(o.cwd, { recursive: true, force: true });
  expect(o.tools).toEqual([]);
  expect(o.allowedTools).toEqual(["mcp__statmesh__*"]);
  expect(o.permissionMode).toBe("dontAsk");
  expect(o.settingSources).toEqual([]);
  expect(o.persistSession).toBe(false);
  expect(o.maxTurns).toBe(10);
  // Explicit undefined, not absence: the provider merges process.env under this object.
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) {
    expect(k in o.env).toBe(true);
    expect(o.env[k]).toBeUndefined();
  }
  expect(o.strictMcpConfig).toBe(true);
  expect(JSON.stringify(o)).not.toContain("--bare");
});

it("honours STATMESH_CLAUDE_BIN", () => {
  vi.stubEnv("STATMESH_CLAUDE_BIN", "/opt/claude");
  const o = cliOptions();
  rmSync(o.cwd, { recursive: true, force: true });
  expect(o.pathToClaudeCodeExecutable).toBe("/opt/claude");
});

it("maps missing binary and login failures to actionable text", () => {
  expect(describeCliError(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }))).toMatch(/not found.*STATMESH_CLAUDE_BIN/);
  expect(describeCliError(new Error("authentication_failed"))).toMatch(/not logged in/);
  expect(describeCliError(new Error("boom"))).toBe("boom");
});

it("bridges MCP-style JSON Schema tools and unwraps their result envelope", async () => {
  const tools = {
    search_series: {
      description: "d",
      inputSchema: jsonSchema({ type: "object", properties: { q: { type: "string" } }, required: ["q"] }),
      execute: async () => ({ content: [{ type: "text", text: '{"n":1}' }] }),
    },
  };
  const b = bridge(tools);
  expect(() => createAiSdkMcpServer("statmesh", b as never)).not.toThrow();
  expect(await b.search_series.execute?.({} as never, {} as never)).toEqual({ n: 1 });
});

it("the child process never sees the API-billing env, even though the provider re-adds process.env", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const out = join(dir, "env.txt");
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\nenv > "${out}"\nexit 1\n`);
  chmodSync(bin, 0o755);
  vi.stubEnv("STATMESH_CLAUDE_BIN", bin);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-leak-test");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "tok-leak-test");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://leak.example");
  vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "1");
  try {
    const r = streamViaCli({ model: "haiku", instructions: "x", messages: [{ role: "user", content: "hi" }], tools: {} });
    for await (const _ of r.fullStream) void _; // the fake exits 1; we only need it to have started
  } catch {
    /* expected: the fake is not a real CLI */
  }
  const env = readFileSync(out, "utf8");
  rmSync(dir, { recursive: true, force: true });
  expect(env).toContain("PATH="); // it did run with an environment
  expect(env).not.toMatch(/ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL)|CLAUDE_CODE_USE_BEDROCK|leak/);
});

// Recorded from the API's MCP `search_series` (pydantic): optionals are anyOf-null, limit/offset are bounded ints.
const SEARCH_SERIES_SCHEMA = {
  type: "object",
  properties: {
    q: { default: "", type: "string" },
    geo: { anyOf: [{ type: "string" }, { type: "null" }], default: null },
    source: { anyOf: [{ type: "string" }, { items: { type: "string" }, type: "array" }, { type: "null" }], default: null },
    start_year: { anyOf: [{ type: "integer" }, { type: "null" }], default: null },
    limit: { default: 10, maximum: 100, minimum: 1, type: "integer" },
    offset: { default: 0, minimum: 0, type: "integer" },
  },
};

it("keeps the arguments in the advertised schema (a swallowed conversion error would leave it empty)", () => {
  const shape = (bridge({ search_series: { inputSchema: jsonSchema(SEARCH_SERIES_SCHEMA as never), execute: async () => ({}) } }).search_series.inputSchema as { shape: object }).shape;
  expect(Object.keys(shape)).toEqual(expect.arrayContaining(["q", "geo", "source", "start_year", "limit", "offset"]));
});

it("accepts every argument shape the real search_series accepts, through the Agent SDK's MCP path (-32602 regression)", async () => {
  const seen: unknown[] = [];
  const tools = {
    search_series: { inputSchema: jsonSchema(SEARCH_SERIES_SCHEMA as never), execute: async (i: unknown) => (seen.push(i), { ok: 1 }) },
    show_chart: tool({ inputSchema: showChartInput, execute: async (i: unknown) => (seen.push(i), { ok: 1 }) }),
  };
  const srv = createAiSdkMcpServer("statmesh", bridge(tools) as never) as unknown as { instance: { connect(t: unknown): Promise<void> } };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await srv.instance.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: unknown };
  const cases: [Record<string, unknown>, unknown][] = [
    [{ q: "x", limit: "5", geo: null, source: ["a", "b"] }, { q: "x", limit: "5", source: ["a", "b"] }],
    [{ q: "x", limit: 500 }, { q: "x", limit: 500 }],
    [{}, {}],
    [{ q: "x", source: null, limit: null, offset: null, start_year: null }, { q: "x" }],
    [{ q: "x", start_year: "2010" }, { q: "x", start_year: "2010" }],
  ];
  for (const [args, expected] of cases) {
    seen.length = 0;
    const r = await call("search_series", args);
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(seen).toEqual([expected]);
  }
  // show_chart keeps a zod schema: null for its optionals must not be a -32602 either
  const c = await call("show_chart", { title: "t", type: "line", series: [{ series_id: "X", label: null }], y_label: null, start: null, end: null });
  expect(c.isError, JSON.stringify(c.content)).toBeFalsy();
  await client.close();
});

it("loosen terminates on numbers and drops defaults", () => {
  const l = loosen({ type: "object", properties: { n: { type: "integer", default: 3, minimum: 1 } } }) as { properties: { n: unknown } };
  expect(JSON.stringify(l.properties.n)).toBe('{"anyOf":[{"anyOf":[{"type":"number"},{"type":"string"}]},{"type":"null"}]}');
});
