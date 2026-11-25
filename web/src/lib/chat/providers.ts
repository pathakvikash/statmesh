import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type ProviderKind = "openai" | "anthropic" | "ollama" | "claude-cli" | "openrouter" | "opencode" | "lmstudio" | "free" | "browser";
export type ProviderConfig = { kind: ProviderKind; baseUrl: string; model: string; apiKey: string };

/** Presets fill the settings form; baseUrl stays editable for any OpenAI-compatible endpoint. */
export const PRESETS: Record<ProviderKind, { label: string; baseUrl: string; keyRequired: boolean; model: string }> = {
  openai: { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", keyRequired: true, model: "" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", keyRequired: true, model: "" },
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", keyRequired: false, model: "" },
  lmstudio: { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", keyRequired: false, model: "qwen/qwen3.5-9b" },
  "claude-cli": { label: "Claude CLI (your plan, local only)", baseUrl: "", keyRequired: false, model: "sonnet" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyRequired: true, model: "" },
  opencode: { label: "OpenCode", baseUrl: "https://opencode.ai/inference/openai/v1", keyRequired: true, model: "" },
  // Server-funded shared assistant (lib/chat/free.ts): the route replaces the whole config from server env.
  // Runs in the visitor's browser (WebGPU, lib/chat/browser-llm.ts): never sent to the server's chat route.
  browser: { label: "On-device (WebGPU)", baseUrl: "", keyRequired: false, model: "" },
  free: { label: "Free assistant", baseUrl: "https://api.groq.com/openai/v1", keyRequired: false, model: "openai/gpt-oss-120b" },
};

/** The claude CLI aliases; the value goes to argv, so validateConfig allowlists it. */
export const CLI_MODELS = [
  { id: "sonnet", label: "Sonnet (latest)" },
  { id: "opus", label: "Opus (latest)" },
  { id: "haiku", label: "Haiku (latest)" },
] as const;

/** The claude CLI runs as the server's OS user on the user's own plan: never on a public deployment. */
export const cliAllowed = (hosted: boolean) => !hosted && !process.env.VERCEL;

/** Current Anthropic models for the settings picker. Custom names are typed in Settings. */
export const ANTHROPIC_MODELS = [
  { id: "claude-fable-5-2", label: "Fable 5.2" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
] as const;

export const resolveBaseUrl =(c: Pick<ProviderConfig, "kind" | "baseUrl">) =>
  (c.baseUrl.trim() || PRESETS[c.kind].baseUrl).replace(/\/+$/, "");

/** Error text for a missing key; the UI matches on it to show the inline prompt. */
export const MISSING_KEY = "Enter your API key.";

const ENV_KEY: Partial<Record<ProviderKind, string>> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

/**
 * The web server's own key for a provider. Self-hosted: always. Hosted (public): only with
 * STATMESH_ALLOW_SERVER_KEY=1. Never returned to the browser: the chat route uses it, the models route
 * reports only whether one exists.
 */
export function serverKeyFor(kind: ProviderKind, hosted: boolean, env: Record<string, string | undefined> = process.env): string | undefined {
  const name = ENV_KEY[kind];
  if (!name || (hosted && env.STATMESH_ALLOW_SERVER_KEY !== "1")) return undefined;
  return env[name]?.trim() || undefined;
}

/**
 * Fills in the server key when the browser sent none. Only for the provider's own preset URL: a custom
 * base URL would otherwise receive the server's key.
 */
export function withServerKey(c: Partial<ProviderConfig>, hosted: boolean, env?: Record<string, string | undefined>): Partial<ProviderConfig> {
  if (!c.kind || !(c.kind in PRESETS) || c.apiKey?.trim()) return c;
  if (typeof c.baseUrl === "string" && c.baseUrl.trim() && resolveBaseUrl({ kind: c.kind, baseUrl: c.baseUrl }) !== PRESETS[c.kind].baseUrl) return c;
  const apiKey = serverKeyFor(c.kind, hosted, env);
  return apiKey ? { ...c, apiKey } : c;
}

/** Returns an error message, or null when the config is usable. */
export function validateConfig(c: Partial<ProviderConfig>): string | null {
  if (!c.kind || !(c.kind in PRESETS)) return "Choose a provider.";
  if ([c.model, c.apiKey, c.baseUrl].some((v) => v !== undefined && typeof v !== "string")) return "Invalid provider settings.";
  if (!c.model?.trim()) return "Enter a model name.";
  if (c.kind === "claude-cli") return CLI_MODELS.some((m) => m.id === c.model) ? null : "Choose sonnet, opus or haiku.";
  if (PRESETS[c.kind].keyRequired && !c.apiKey?.trim()) return MISSING_KEY;
  try {
    const u = new URL(resolveBaseUrl({ kind: c.kind, baseUrl: c.baseUrl ?? "" }));
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Base URL must be http(s).";
  } catch {
    return "Base URL is not a valid URL.";
  }
  return null;
}

export function buildModel(c: ProviderConfig): LanguageModel {
  if (c.kind === "claude-cli") throw new Error("claude-cli runs through streamViaCli, not buildModel.");
  const baseURL = resolveBaseUrl(c);
  // LM Studio ignores the key but the adapter wants one to send.
  const apiKey = c.apiKey.trim() || (c.kind === "lmstudio" ? "lm-studio" : undefined);
  // Redirects are refused: a provider URL must not bounce the server to an internal address.
  const fetch: typeof globalThis.fetch = (u, init) => globalThis.fetch(u, { ...init, redirect: "error" });
  if (c.kind === "anthropic") return createAnthropic({ apiKey, baseURL, fetch })(c.model);
  return createOpenAICompatible({ name: c.kind, baseURL, apiKey, fetch }).chatModel(c.model);
}
