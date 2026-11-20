import { describe, expect, it } from "vitest";
import { buildModel, MISSING_KEY, PRESETS, resolveBaseUrl, serverKeyFor, validateConfig, withServerKey, type ProviderConfig } from "./providers";

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
