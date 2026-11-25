// Lists the models a provider offers, for the settings pickers. Server-side only: it fetches
// the user's base URL, so it runs the same validation as the chat route before any request.
import { checkBaseUrl, type Lookup } from "./host-check";
import { PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig } from "./providers";

const TIMEOUT_MS = 5000;
const MAX_BYTES = 4 * 1024 * 1024; // OpenRouter's full list with pricing is over 1 MB

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);

/** Ollama GET /api/tags: { models: [{ name }] }. Null when the shape is not a model list. */
export function parseOllamaTags(json: unknown): string[] | null {
  const models = rec(json)?.models;
  if (!Array.isArray(models)) return null;
  return uniq(models.map((m) => rec(m)?.name));
}

/** OpenAI-compatible GET /models: { data: [{ id }] }. Null when the shape is not a model list. */
export function parseOpenAIModels(json: unknown, freeOnly = false): string[] | null {
  const data = rec(json)?.data;
  if (!Array.isArray(data)) return null;
  const all = uniq(data.map((m) => rec(m)?.id));
  if (!freeOnly) return all;
  const free = uniq(data.filter(isFree).map((m) => rec(m)?.id));
  // ponytail: if a provider marks nothing free, show the full list rather than an empty picker
  return free.length ? free : all;
}

/** Free = both prices are zero (OpenRouter), or the id carries a free marker (":free", "-free"). */
function isFree(m: unknown): boolean {
  const o = rec(m);
  const price = rec(o?.pricing);
  if (price && "prompt" in price && "completion" in price) return Number(price.prompt) === 0 && Number(price.completion) === 0;
  return typeof o?.id === "string" && /[:-]free$/.test(o.id);
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
export async function listModels(input: unknown, deps: { fetch?: typeof globalThis.fetch; lookup?: Lookup } = {}): Promise<ModelListResult> {
  const r = await listOnce(input, deps);
  const c = rec(input);
  // OpenCode's model list may sit beside its OpenAI route rather than under it; try that when the preset URL fails.
  if (!r.ok && c?.kind === "opencode" && typeof c.baseUrl === "string" && resolveBaseUrl({ kind: "opencode", baseUrl: c.baseUrl }) === PRESETS.opencode.baseUrl) {
    const alt = await listOnce({ ...c, baseUrl: "https://opencode.ai/inference/v1" }, deps);
    if (alt.ok) return alt;
  }
  return r;
}

async function listOnce(
  input: unknown,
  deps: { fetch?: typeof globalThis.fetch; lookup?: Lookup },
): Promise<ModelListResult> {
  const c = (rec(input) ?? {}) as Partial<ProviderConfig>;
  if ([c.model, c.apiKey, c.baseUrl].some((v) => v !== undefined && typeof v !== "string")) return fail(400, "Invalid provider settings.");
  if (c.kind === "claude-cli") return fail(400, "Claude CLI models are chosen from the list in Settings.");
  if (c.kind === "anthropic") return fail(400, "Anthropic models are chosen from the list in Settings.");
  const probe = {
    ...c,
    model: c.model?.trim() || "list",
    apiKey: c.apiKey?.trim() || (c.kind && c.kind in PRESETS && PRESETS[c.kind].keyRequired ? "list" : ""),
  };
  const bad = validateConfig(probe) ?? (await checkBaseUrl(resolveBaseUrl(probe as ProviderConfig), { lookup: deps.lookup }));
  if (bad) return fail(400, bad);

  const kind = c.kind === "ollama" ? "ollama" : "openai"; // openrouter and opencode speak the OpenAI /models shape
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
  // OpenRouter and OpenCode lists are huge: show only free models unless the caller sets freeOnly: false.
  const freeOnly = (c.kind === "openrouter" || c.kind === "opencode") && rec(input)?.freeOnly !== false;
  const models = kind === "ollama" ? parseOllamaTags(json) : parseOpenAIModels(json, freeOnly);
  if (!models) return fail(502, "The server's answer was not a model list.");
  return { ok: true, models };
}
