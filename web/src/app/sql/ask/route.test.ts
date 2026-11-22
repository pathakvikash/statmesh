import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateText, generateViaCli } = vi.hoisted(() => ({
  generateText: vi.fn(async () => ({ text: "```sql\nSELECT 1\n```" })),
  generateViaCli: vi.fn(async () => "SELECT 2"),
}));
vi.mock("ai", () => ({ generateText }));
vi.mock("@/lib/chat/providers", async (orig) => ({ ...(await orig<typeof import("@/lib/chat/providers")>()), buildModel: () => ({}) as never }));
vi.mock("@/lib/chat/host-check", () => ({ checkBaseUrl: async () => null }));
vi.mock("@/lib/chat/claude-cli", () => ({ generateViaCli }));
vi.mock("@/lib/sql-schema", () => ({ loadSchema: async () => ({ schema: { views: [] }, live: false }) }));
import { POST } from "./route";

const keyed = { kind: "anthropic", baseUrl: "", model: "claude-sonnet-5-5", apiKey: "sk-user" };
const cli = { kind: "claude-cli", baseUrl: "", model: "haiku", apiKey: "" };
const local = { host: "localhost:3000", "sec-fetch-site": "same-origin" };
const post = (config: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/sql/ask", { method: "POST", body: JSON.stringify({ config, question: "inflation in India" }), headers }));
const ENV = ["STATMESH_MODE", "VERCEL", "STATMESH_ALLOW_SERVER_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

beforeEach(() => {
  for (const k of ENV) vi.stubEnv(k, "");
  vi.stubEnv("STATMESH_MODE", "");
  generateText.mockClear();
  generateViaCli.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /sql/ask", () => {
  it("hosted: 404 and no model call", async () => {
    vi.stubEnv("STATMESH_MODE", "hosted");
    expect((await post(keyed)).status).toBe(404);
    expect(generateText).not.toHaveBeenCalled();
  });
  it("hosted with ALLOW_SERVER_KEY=1 and a user key: 200, fences stripped", async () => {
    vi.stubEnv("STATMESH_MODE", "hosted");
    vi.stubEnv("STATMESH_ALLOW_SERVER_KEY", "1");
    const r = await post(keyed);
    expect(r.status).toBe(200);
    expect((await r.json()).sql).toBe("SELECT 1");
  });
  it("hosted + ALLOW=1: claude-cli is refused", async () => {
    vi.stubEnv("STATMESH_MODE", "hosted");
    vi.stubEnv("STATMESH_ALLOW_SERVER_KEY", "1");
    expect((await post(cli, local)).status).toBe(403);
    expect(generateViaCli).not.toHaveBeenCalled();
  });
  it("no key and no server key: 400", async () => {
    expect((await post({ ...keyed, apiKey: "" })).status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });
  it("uses the server key when the browser sent none", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-server");
    expect((await post({ ...keyed, apiKey: "" })).status).toBe(200);
  });
  it("claude-cli: loopback same-origin runs it", async () => {
    const r = await post(cli, local);
    expect(r.status).toBe(200);
    expect((await r.json()).sql).toBe("SELECT 2");
  });
  it("claude-cli: non-loopback or cross-site origin is refused", async () => {
    expect((await post(cli, { host: "statmesh.example", "sec-fetch-site": "same-origin" })).status).toBe(403);
    expect((await post(cli, { host: "localhost:3000", origin: "https://evil.example" })).status).toBe(403);
    expect(generateViaCli).not.toHaveBeenCalled();
  });
});
