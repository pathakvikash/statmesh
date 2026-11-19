import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type ProviderKind = "openai" | "anthropic" | "ollama";
export type ProviderConfig = { kind: ProviderKind; baseUrl: string; model: string; apiKey: string };

/** Presets fill the settings form; baseUrl stays editable for any OpenAI-compatible endpoint. */
export const PRESETS: Record<ProviderKind, { label: string; baseUrl: string; keyRequired: boolean; model: string }> = {
  openai: { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", keyRequired: true, model: "" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", keyRequired: true, model: "" },
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", keyRequired: false, model: "" },
};

export const resolveBaseUrl = (c: Pick<ProviderConfig, "kind" | "baseUrl">) =>
  (c.baseUrl.trim() || PRESETS[c.kind].baseUrl).replace(/\/+$/, "");

/** Returns an error message, or null when the config is usable. */
export function validateConfig(c: Partial<ProviderConfig>): string | null {
  if (!c.kind || !(c.kind in PRESETS)) return "Choose a provider.";
  if (!c.model?.trim()) return "Enter a model name.";
  if (PRESETS[c.kind].keyRequired && !c.apiKey?.trim()) return "Enter your API key.";
  try {
    const u = new URL(resolveBaseUrl({ kind: c.kind, baseUrl: c.baseUrl ?? "" }));
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Base URL must be http(s).";
  } catch {
    return "Base URL is not a valid URL.";
  }
  return null;
}

export function buildModel(c: ProviderConfig): LanguageModel {
  const baseURL = resolveBaseUrl(c);
  const apiKey = c.apiKey.trim() || undefined;
  if (c.kind === "anthropic") return createAnthropic({ apiKey, baseURL })(c.model);
  return createOpenAICompatible({ name: c.kind, baseURL, apiKey }).chatModel(c.model);
}
