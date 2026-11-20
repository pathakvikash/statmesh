// Lists the models a provider offers, for the settings pickers. Server-side only: it fetches
// the user's base URL, so it runs the same validation as the chat route before any request.
import { checkBaseUrl, type Lookup } from "./host-check";
import { PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig } from "./providers";

const TIMEOUT_MS = 5000;
const MAX_BYTES = 256 * 1024;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);

/** Ollama GET /api/tags: { models: [{ name }] }. Null when the shape is not a model list. */
export function parseOllamaTags(json: unknown): string[] | null {
  const models = rec(json)?.models;
  if (!Array.isArray(models)) return null;
  return uniq(models.map((m) => rec(m)?.name));
}

/** OpenAI-compatible GET /models: { data: [{ id }] }. Null when the shape is not a model list. */
export function parseOpenAIModels(json: unknown): string[] | null {
  const data = rec(json)?.data;
  if (!Array.isArray(data)) return null;
  return uniq(data.map((m) => rec(m)?.id));
}

function uniq(values: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of values) if (typeof v === "string" && v.trim()) out.add(v.trim());
  return [...out];
}

/** Ollama's base URL carries /v1 for the chat adapter; its native API sits at the root. */
export const ollamaRoot = (baseUrl: string) => baseUrl.replace(/\/v1$/, "");

export function modelListUrl(kind: "ollama" | "openai", baseUrl: string): string {
  return kind === "ollama" ? `${ollamaRoot(baseUrl)}/api/tags` : `${baseUrl}/models`;
}

/** Reads at most `max` bytes, so a hostile or broken server cannot exhaust memory. */
export async function readJsonCapped(res: Response, max = MAX_BYTES): Promise<unknown> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) throw new Error("too large");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return JSON.parse(text);
}

export type ModelListResult = { ok: true; models: string[] } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ModelListResult => ({ ok: false, status, error });

/**
 * Validation mirrors the chat route. The model and key are placeholders here: listing needs no
 * model, and the real key is sent only when set, so keyless OpenAI-compatible servers still work.
 */
export async function listModels(
  input: unknown,
  deps: { fetch?: typeof globalThis.fetch; lookup?: Lookup } = {},
): Promise<ModelListResult> {
  const c = (rec(input) ?? {}) as Partial<ProviderConfig>;
  if ([c.model, c.apiKey, c.baseUrl].some((v) => v !== undefined && typeof v !== "string")) return fail(400, "Invalid provider settings.");
  if (c.kind === "anthropic") return fail(400, "Anthropic models are chosen from the list in Settings.");
  const probe = {
    ...c,
    model: c.model?.trim() || "list",
    apiKey: c.apiKey?.trim() || (c.kind && c.kind in PRESETS && PRESETS[c.kind].keyRequired ? "list" : ""),
  };
  const bad = validateConfig(probe) ?? (await checkBaseUrl(resolveBaseUrl(probe as ProviderConfig), { lookup: deps.lookup }));
  if (bad) return fail(400, bad);

  const kind = c.kind as "ollama" | "openai";
  const base = resolveBaseUrl(probe as ProviderConfig);
  const url = modelListUrl(kind, base);
  const headers: Record<string, string> = { accept: "application/json" };
  const key = c.apiKey?.trim();
  if (kind === "openai" && key) headers.authorization = `Bearer ${key}`;
  const where = kind === "ollama" ? `Ollama at ${ollamaRoot(base)}. Start it with \`ollama serve\`.` : `${base}. Check the base URL.`;

  let res: Response;
  try {
    // Redirects are refused, as in buildModel: a provider URL must not bounce to another address.
    res = await (deps.fetch ?? globalThis.fetch)(url, { headers, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return fail(502, timedOut ? `No answer from ${where}` : `Could not reach ${where}`);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return fail(502, "The server rejected the API key.");
    return fail(502, `The server answered with HTTP ${res.status} instead of a model list.`);
  }
  let json: unknown;
  try {
    json = await readJsonCapped(res);
  } catch (e) {
    const tooLarge = (e as Error)?.message === "too large";
    return fail(502, tooLarge ? "The model list is too large." : "The server's answer was not valid JSON.");
  }
  const models = kind === "ollama" ? parseOllamaTags(json) : parseOpenAIModels(json);
  if (!models) return fail(502, "The server's answer was not a model list.");
  return { ok: true, models };
}
