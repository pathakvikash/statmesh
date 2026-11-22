import { describe, expect, it, vi } from "vitest";
import { checkBaseUrl } from "./host-check";
import { buildModel, cliAllowed, MISSING_KEY, PRESETS, resolveBaseUrl, serverKeyFor, validateConfig, withServerKey, type ProviderConfig } from "./providers";

const ok: ProviderConfig = { kind: "openai", baseUrl: "", model: "gpt-x", apiKey: "k" };

describe("provider config", () => {
  it("falls back to the preset base URL and trims slashes", () => {
    expect(resolveBaseUrl(ok)).toBe(PRESETS.openai.baseUrl);
    expect(resolveBaseUrl({ kind: "openai", baseUrl: "https://llm.example/v1//" })).toBe("https://llm.example/v1");
    expect(resolveBaseUrl({ kind: "ollama", baseUrl: "" })).toBe("http://localhost:11434/v1");
  });
  it("accepts a complete config", () => {
    expect(validateConfig(ok)).toBeNull();
  });
  it("requires a model and, except for Ollama, a key", () => {
    expect(validateConfig({ ...ok, model: " " })).toMatch(/model/i);
    expect(validateConfig({ ...ok, apiKey: "" })).toMatch(/key/i);
    expect(validateConfig({ ...ok, kind: "ollama", apiKey: "" })).toBeNull();
    expect(validateConfig({ ...ok, kind: "anthropic", apiKey: "" })).toMatch(/key/i);
  });
  it("rejects bad URLs and unknown providers", () => {
    expect(validateConfig({ ...ok, baseUrl: "not a url" })).toMatch(/URL/);
    expect(validateConfig({ ...ok, baseUrl: "ftp://x/v1" })).toMatch(/http/);
    expect(validateConfig({ ...ok, kind: "bogus" as never })).toMatch(/provider/i);
  });
  it("builds a model object for each adapter without any network call", () => {
    for (const kind of ["openai", "anthropic", "ollama"] as const) {
      expect(buildModel({ ...ok, kind, model: "m" })).toBeTruthy();
    }
  });
});

describe("server key fallback", () => {
  const env = { ANTHROPIC_API_KEY: " sk-ant ", OPENAI_API_KEY: "sk-oai" };
  it("reads the env key per provider, never when hosted or for Ollama", () => {
    expect(serverKeyFor("anthropic", false, env)).toBe("sk-ant");
    expect(serverKeyFor("openai", false, env)).toBe("sk-oai");
    expect(serverKeyFor("anthropic", true, env)).toBeUndefined();
    expect(serverKeyFor("ollama", false, env)).toBeUndefined();
    expect(serverKeyFor("anthropic", false, {})).toBeUndefined();
  });
  it("hosted uses the server key only with the explicit opt-in", () => {
    const on = { ...env, STATMESH_ALLOW_SERVER_KEY: "1" };
    expect(serverKeyFor("anthropic", true, on)).toBe("sk-ant");
    expect(serverKeyFor("anthropic", true, { ...env, STATMESH_ALLOW_SERVER_KEY: "true" })).toBeUndefined();
    const a = { ...ok, kind: "anthropic" as const, baseUrl: PRESETS.anthropic.baseUrl, apiKey: "" };
    expect(withServerKey(a, true, on).apiKey).toBe("sk-ant");
    expect(withServerKey(a, true, env).apiKey).toBe("");
  });
  it("fills a missing key, keeps a typed one", () => {
    const a = { ...ok, kind: "anthropic" as const, baseUrl: PRESETS.anthropic.baseUrl, apiKey: "" };
    expect(withServerKey(a, false, env).apiKey).toBe("sk-ant");
    expect(validateConfig(withServerKey(a, false, env))).toBeNull();
    expect(withServerKey({ ...a, apiKey: "mine" }, false, env).apiKey).toBe("mine");
    expect(validateConfig(withServerKey(a, true, env))).toBe(MISSING_KEY);
  });
  it("never hands the server key to a custom base URL", () => {
    expect(withServerKey({ ...ok, baseUrl: "https://evil.example/v1", apiKey: "" }, false, env).apiKey).toBe("");
  });
});

describe("claude-cli, openrouter and opencode", () => {
  const cli: ProviderConfig = { kind: "claude-cli", baseUrl: "", model: "sonnet", apiKey: "" };
  it("allows the CLI only when not hosted", () => {
    expect(cliAllowed(false)).toBe(true);
    expect(cliAllowed(true)).toBe(false);
    vi.stubEnv("VERCEL", "1");
    expect(cliAllowed(false)).toBe(false);
    vi.unstubAllEnvs();
  });
  it("claude-cli needs no key or URL, and allowlists the model (it goes to argv)", () => {
    expect(validateConfig(cli)).toBeNull();
    expect(validateConfig({ ...cli, model: "x; rm" })).toMatch(/sonnet, opus or haiku/);
    expect(validateConfig({ ...cli, model: "claude-opus-5-5" })).toMatch(/sonnet, opus or haiku/);
  });
  it("claude-cli never builds an AI SDK model", () => {
    expect(() => buildModel(cli)).toThrow();
  });
  it("openrouter and opencode need a key and build a model", () => {
    for (const kind of ["openrouter", "opencode"] as const) {
      expect(validateConfig({ kind, baseUrl: "", model: "m", apiKey: "" })).toBe(MISSING_KEY);
      expect(validateConfig({ kind, baseUrl: "", model: "m", apiKey: "k" })).toBeNull();
      expect(buildModel({ kind, baseUrl: "", model: "m", apiKey: "k" })).toBeTruthy();
    }
  });
  it("never uses a server key for them", () => {
    const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", STATMESH_ALLOW_SERVER_KEY: "1" };
    for (const k of ["openrouter", "opencode", "claude-cli"] as const) expect(serverKeyFor(k, false, env)).toBeUndefined();
  });
});

describe("lmstudio", () => {
  const lm: ProviderConfig = { kind: "lmstudio", baseUrl: "", model: "qwen/qwen3.5-9b", apiKey: "" };
  it("is OpenAI-compatible on localhost:1234 and needs no key", () => {
    expect(PRESETS.lmstudio).toMatchObject({ label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", keyRequired: false });
    expect(resolveBaseUrl(lm)).toBe("http://localhost:1234/v1");
    expect(validateConfig(lm)).toBeNull();
    expect(buildModel(lm)).toBeTruthy();
  });
  it("never takes a server key", () => {
    expect(serverKeyFor("lmstudio", false, { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })).toBeUndefined();
  });
  it("is refused on a hosted server (loopback) by the SSRF guard", async () => {
    expect(await checkBaseUrl(resolveBaseUrl(lm), { hosted: true })).not.toBeNull();
    expect(await checkBaseUrl("http://localhost:1234/v1", { hosted: false })).toBeNull();
  });
});
