import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const streamViaCli = vi.fn();
vi.mock("@/lib/chat/claude-cli", () => ({ streamViaCli, describeCliError: String }));
import { POST } from "./route";

const cliBody = { config: { kind: "claude-cli", baseUrl: "", model: "haiku", apiKey: "" }, messages: [{ role: "user", content: "hi" }] };
const post = (b: unknown, headers: Record<string, string> = {}) => POST(new Request("http://x/chat/api", { method: "POST", body: JSON.stringify(b), headers }));
const local = { host: "localhost:3000", "sec-fetch-site": "same-origin" };
const saved = { m: process.env.STATMESH_MODE, v: process.env.VERCEL };
const restore = (k: "STATMESH_MODE" | "VERCEL", v?: string) => (v === undefined ? delete process.env[k] : (process.env[k] = v));

beforeEach(() => streamViaCli.mockClear());
afterEach(() => { restore("STATMESH_MODE", saved.m); restore("VERCEL", saved.v); });

describe("POST /chat/api claude-cli", () => {
  beforeEach(() => { delete process.env.STATMESH_MODE; delete process.env.VERCEL; });
  it("passes the gate for a same-origin loopback request", async () => {
    expect((await post(cliBody, local)).status).toBe(200); // a stream; the API is not reachable here, so it ends in an error event
    expect((await post(cliBody, { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })).status).toBe(200);
    expect((await post(cliBody, { host: "[::1]:3000", origin: "http://[::1]:3000" })).status).toBe(200);
  });
  it("rejects a cross-site request", async () => {
    expect((await post(cliBody, { host: "localhost:3000", origin: "https://evil.example" })).status).toBe(403);
    expect((await post(cliBody, { host: "localhost:3000", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(cliBody, { host: "localhost:3000" })).status).toBe(403); // no Origin, no Sec-Fetch-Site
  });
  it("rejects a non-loopback Host even when same-origin", async () => {
    expect((await post(cliBody, { host: "192.168.1.5:3000", origin: "http://192.168.1.5:3000", "sec-fetch-site": "same-origin" })).status).toBe(403);
    expect((await post(cliBody, { host: "statmesh.example", "sec-fetch-site": "same-origin" })).status).toBe(403);
    expect(streamViaCli).not.toHaveBeenCalled();
  });
  it("is refused with 403 when STATMESH_MODE=hosted", async () => {
    process.env.STATMESH_MODE = "hosted";
    const r = await post(cliBody, local);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/only available when running statmesh locally/);
    expect(streamViaCli).not.toHaveBeenCalled();
  });
  it("is refused on Vercel when STATMESH_MODE is unset", async () => {
    delete process.env.STATMESH_MODE;
    process.env.VERCEL = "1";
    expect((await post(cliBody, local)).status).toBe(403);
    expect(streamViaCli).not.toHaveBeenCalled();
  });
});

// Opt-in: real API (STATMESH_API_URL, default localhost:8000) and a logged-in `claude`. Costs plan usage.
describe.skipIf(process.env.RUN_CLI_E2E !== "1")("claude-cli end to end", () => {
  it("answers a statistic question through search_series", async () => {
    delete process.env.STATMESH_MODE;
    delete process.env.VERCEL;
    const { POST: real } = await vi.importActual<typeof import("./route")>("./route");
    vi.doUnmock("@/lib/chat/claude-cli");
    const r = await real(new Request("http://localhost:3000/chat/api", { method: "POST", headers: local, body: JSON.stringify({ ...cliBody, messages: [{ role: "user", content: "What is the latest US unemployment rate? Search first." }] }) }));
    const text = await r.text();
    expect(text).toContain('"name":"search_series"');
    expect(text).not.toContain("mcp__");
  }, 150_000);
});
