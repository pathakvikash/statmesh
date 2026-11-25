import { describe, expect, it } from "vitest";
import { listModels, modelListUrl, parseOllamaTags, parseOpenAIModels, readJsonCapped } from "./model-list";

const publicHost = async () => [{ address: "203.0.113.7" }];
const metadataHost = async () => [{ address: "169.254.169.254" }];

/** A fetch stub that records each call and answers with `res`. */
function stubFetch(res: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return res();
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parsers", () => {
  it("reads Ollama names from models[].name", () => {
    expect(parseOllamaTags({ models: [{ name: "llama3.2:latest" }, { name: "qwen2.5" }, { name: "" }, { size: 1 }] }))
      .toEqual(["llama3.2:latest", "qwen2.5"]);
    expect(parseOllamaTags({ models: [] })).toEqual([]);
  });
  it("reads OpenAI-compatible ids from data[].id and drops duplicates", () => {
    expect(parseOpenAIModels({ object: "list", data: [{ id: "gpt-x" }, { id: "gpt-x" }, { id: "embed" }] }))
      .toEqual(["gpt-x", "embed"]);
  });
  it("returns null when the shape is not a model list", () => {
    expect(parseOllamaTags({ error: "nope" })).toBeNull();
    expect(parseOllamaTags(null)).toBeNull();
    expect(parseOpenAIModels({ models: [] })).toBeNull();
    expect(parseOpenAIModels("text")).toBeNull();
  });
  it("builds the list URL per provider, dropping /v1 for Ollama", () => {
    expect(modelListUrl("ollama", "http://localhost:11434/v1")).toBe("http://localhost:11434/api/tags");
    expect(modelListUrl("ollama", "http://gpu.lan:11434")).toBe("http://gpu.lan:11434/api/tags");
    expect(modelListUrl("openai", "https://api.openai.com/v1")).toBe("https://api.openai.com/v1/models");
  });
});

describe("readJsonCapped", () => {
  it("parses a small body", async () => {
    expect(await readJsonCapped(json({ a: 1 }))).toEqual({ a: 1 });
  });
  it("refuses a body over the cap", async () => {
    await expect(readJsonCapped(new Response("x".repeat(50)), 10)).rejects.toThrow("too large");
  });
});

describe("listModels", () => {
  it("lists Ollama models from /api/tags, with no key header and no redirects", async () => {
    const { fn, calls } = stubFetch(() => json({ models: [{ name: "llama3.2" }] }));
    const r = await listModels({ kind: "ollama", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" },
      { fetch: fn, lookup: publicHost });
    expect(r).toEqual({ ok: true, models: ["llama3.2"] });
    expect(calls[0].url).toBe("http://localhost:11434/api/tags");
    expect(calls[0].init.redirect).toBe("error");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("sends the key as Bearer for OpenAI-compatible endpoints only when set", async () => {
    const { fn, calls } = stubFetch(() => json({ data: [{ id: "m1" }] }));
    await listModels({ kind: "openai", baseUrl: "https://llm.example/v1", model: "", apiKey: "sk-test" }, { fetch: fn, lookup: publicHost });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(calls[0].url).toBe("https://llm.example/v1/models");
    const keyless = stubFetch(() => json({ data: [] }));
    await listModels({ kind: "openai", baseUrl: "https://llm.example/v1", model: "", apiKey: "" }, { fetch: keyless.fn, lookup: publicHost });
    expect((keyless.calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("runs the same base URL check as chat: metadata addresses are refused before any fetch", async () => {
    const { fn, calls } = stubFetch(() => json({ models: [] }));
    const r = await listModels({ kind: "ollama", baseUrl: "http://meta.example:11434/v1", model: "", apiKey: "" },
      { fetch: fn, lookup: metadataHost });
    expect(r).toEqual({ ok: false, status: 400, error: "That base URL is not allowed." });
    expect(calls).toHaveLength(0);
  });

  it("rejects Anthropic and invalid types", async () => {
    expect(await listModels({ kind: "anthropic", baseUrl: "", model: "", apiKey: "k" })).toMatchObject({ ok: false, status: 400 });
    expect(await listModels({ kind: "ollama", baseUrl: 5 })).toMatchObject({ ok: false, status: 400 });
    expect(await listModels("not an object")).toMatchObject({ ok: false, status: 400 });
  });

  it("explains an unreachable Ollama in plain words", async () => {
    const r = await listModels({ kind: "ollama", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" },
      { fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch, lookup: publicHost });
    expect(r).toEqual({ ok: false, status: 502, error: "Could not reach Ollama at http://localhost:11434. Start it with `ollama serve`." });
  });

  it("says when the server did not answer in time", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const r = await listModels({ kind: "ollama", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" },
      { fetch: (async () => { throw timeout; }) as unknown as typeof fetch, lookup: publicHost });
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect((r as { error: string }).error).toMatch(/^No answer from Ollama/);
  });

  it("never echoes the key in an error", async () => {
    const r = await listModels({ kind: "openai", baseUrl: "https://llm.example/v1", model: "", apiKey: "sk-secret-123" },
      { fetch: (async () => json({ error: "bad sk-secret-123" }, 401)) as unknown as typeof fetch, lookup: publicHost });
    expect(r).toEqual({ ok: false, status: 502, error: "The server rejected the API key." });
    expect(JSON.stringify(r)).not.toContain("sk-secret-123");
  });

  it("reports a non-model answer, an oversized answer and bad JSON generically", async () => {
    const base = { kind: "ollama", baseUrl: "http://localhost:11434/v1", model: "", apiKey: "" } as const;
    expect(await listModels(base, { fetch: stubFetch(() => json({ nope: 1 })).fn, lookup: publicHost }))
      .toMatchObject({ ok: false, error: "The server's answer was not a model list." });
    expect(await listModels(base, { fetch: stubFetch(() => new Response("{", { status: 200 })).fn, lookup: publicHost }))
      .toMatchObject({ ok: false, error: "The server's answer was not valid JSON." });
    expect(await listModels(base, { fetch: stubFetch(() => new Response("x", { status: 500 })).fn, lookup: publicHost }))
      .toMatchObject({ ok: false, error: "The server answered with HTTP 500 instead of a model list." });
    const big = new Response("x".repeat(5 * 1024 * 1024), { status: 200 });
    expect(await listModels(base, { fetch: stubFetch(() => big).fn, lookup: publicHost }))
      .toMatchObject({ ok: false, error: "The model list is too large." });
  });

  it("keeps only free models for OpenRouter and OpenCode, with an opt-out", async () => {
    const list = { data: [
      { id: "a/paid", pricing: { prompt: "0.000002", completion: "0.000004" } },
      { id: "b/free:free", pricing: { prompt: "0", completion: "0" } },
      { id: "big-pickle-free" },
    ] };
    expect(parseOpenAIModels(list, true)).toEqual(["b/free:free", "big-pickle-free"]);
    expect(parseOpenAIModels({ data: [{ id: "x" }] }, true)).toEqual(["x"]); // nothing marked free: show all
    const cfg = { kind: "openrouter", baseUrl: "", model: "", apiKey: "k" } as const;
    expect(await listModels(cfg, { fetch: stubFetch(() => json(list)).fn, lookup: publicHost })).toEqual({ ok: true, models: ["b/free:free", "big-pickle-free"] });
    expect(await listModels({ ...cfg, freeOnly: false }, { fetch: stubFetch(() => json(list)).fn, lookup: publicHost })).toMatchObject({ ok: true, models: ["a/paid", "b/free:free", "big-pickle-free"] });
  });
});
