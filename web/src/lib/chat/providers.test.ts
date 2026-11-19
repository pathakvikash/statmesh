import { describe, expect, it } from "vitest";
import { buildModel, PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig } from "./providers";

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
