// Client-side helpers for the free shared assistant. Contract with the server: provider kind "free" carries no
// key, base URL or model; GET /api/chat/free-status -> {available}; quota hit -> HTTP 429 {code:"free_quota_exhausted", message, resetAt}.
import { PRESETS, type ProviderConfig, type ProviderKind } from "@/lib/chat/providers";

export const FREE_KIND = "free" as ProviderKind;
export const isFree = (kind: string) => kind === "free";
export const FREE_CONFIG: ProviderConfig = { kind: FREE_KIND, baseUrl: "", model: "", apiKey: "" };
export const FREE_LABEL = "Free assistant";
export const FREE_NOTE =
  "Shared and rate-limited. Your prompts are sent to Groq or OpenRouter, so do not enter personal data. Small models can make mistakes: check the cited sources.";

type Preset = { label: string; baseUrl: string; keyRequired: boolean; model: string };
const FREE_PRESET: Preset = { label: FREE_LABEL, baseUrl: "", keyRequired: false, model: "" };
/** PRESETS lookup that also knows "free", whether or not the server's table has it yet. */
export const presetOf = (kind: ProviderKind): Preset => (PRESETS as Record<string, Preset>)[kind] ?? FREE_PRESET;

export type Quota = { message: string; resetAt?: string; unavailable?: boolean };

export const UNAVAILABLE_TEXT = "Free assistant is unavailable. Add your own key or use a local model.";

/** The 429 body for an exhausted free quota, or the 503 {code:"free_unavailable"} body, else null. */
export function parseQuota(status: number, body: unknown): Quota | null {
  const b = body as { code?: unknown; message?: unknown; resetAt?: unknown } | null;
  if (status === 503 && b?.code === "free_unavailable") return { message: UNAVAILABLE_TEXT, unavailable: true };
  if (status !== 429 || b?.code !== "free_quota_exhausted") return null;
  return { message: typeof b.message === "string" ? b.message : "", resetAt: typeof b.resetAt === "string" ? b.resetAt : undefined };
}

/** "Free assistant is busy (resets at 3:05 PM). Add your own key or use a local model." */
export function quotaText(resetAt?: string, locale?: string): string {
  const d = resetAt ? new Date(resetAt) : null;
  const when = d && !Number.isNaN(d.getTime()) ? ` (resets at ${d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })})` : "";
  return `Free assistant is busy${when}. Add your own key or use a local model.`;
}

/**
 * Which provider to start with once storage and free-status are known. Returns "free" to switch, "blank" to
 * drop a stored free choice that is no longer offered, or null to leave the config alone.
 */
export function freeDefault(cur: ProviderConfig, o: { stored: boolean; available: boolean; serverKey: boolean; chosen?: boolean }): "free" | "blank" | null {
  if (isFree(cur.kind)) return o.available ? null : "blank";
  if (o.chosen || !o.available || cur.kind === "claude-cli") return null; // an explicit pick or typed key/model always wins
  const unusable = presetOf(cur.kind).keyRequired && !cur.apiKey.trim() && !o.serverKey;
  return !o.stored || unusable ? "free" : null;
}
