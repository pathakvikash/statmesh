// Dynamic-import wrapper around @mlc-ai/web-llm: nothing here loads until load() is called from a click.
import { BROWSER_MODELS, buildMessages, type Fact } from "@/lib/chat/browser-llm";

type Engine = import("@mlc-ai/web-llm").WebWorkerMLCEngine;
let engine: Engine | undefined, worker: Worker | undefined, loadedId = "";

export type Progress = { pct: number; text: string };

/** Download (first use) and initialise the model. Rejects on failure; call cancel() to abort. */
export async function load(modelId: string, onProgress: (p: Progress) => void): Promise<void> {
  if (engine && loadedId === modelId) return;
  cancel();
  const { CreateWebWorkerMLCEngine, prebuiltAppConfig } = await import("@mlc-ai/web-llm");
  // Pinned Hugging Face revision plus SRI hashes of config, wasm and tokenizer (weight shards are not covered by web-llm's integrity check).
  const pin = BROWSER_MODELS.find((m) => m.id === modelId);
  const base = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  const appConfig = pin && base ? { model_list: [{ ...base, model: `https://huggingface.co/mlc-ai/${pin.id}/resolve/${pin.rev}/`, integrity: pin.integrity }] } : undefined;
  worker = new Worker(new URL("./browser-worker.ts", import.meta.url), { type: "module" });
  const w = worker;
  try {
    engine = await CreateWebWorkerMLCEngine(w, modelId, { appConfig, initProgressCallback: (r) => onProgress({ pct: Math.round(r.progress * 100), text: r.text }) });
    loadedId = modelId;
  } catch (e) {
    if (worker === w) cancel();
    throw e;
  }
}

/** Stops a download or a generation and frees the worker. */
export function cancel() {
  worker?.terminate();
  worker = engine = undefined;
  loadedId = "";
}

export const isLoaded = (modelId: string) => !!engine && loadedId === modelId;
export const stop = () => void engine?.interruptGenerate();

/** Streams the answer text so far (cumulative). */
export async function generate(question: string, facts: Fact[], onText: (t: string) => void): Promise<string> {
  if (!engine) throw new Error("Model not loaded.");
  const s = await engine.chat.completions.create({ messages: buildMessages(question, facts), stream: true, temperature: 0.1, max_tokens: 400 });
  let out = "";
  for await (const c of s) onText((out += c.choices[0]?.delta?.content ?? ""));
  return out;
}

/** Maps a load/generation failure to a short user-facing message. */
export function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/memory|alloc|oom|exceeded/i.test(m)) return "Not enough GPU memory for this model. Try the small model."; // before /gpu/: "out of GPU memory" is this, not "no WebGPU"
  if (/webgpu|adapter|gpu/i.test(m)) return "WebGPU is not available on this device.";
  if (/fetch|network|download|cache|load failed/i.test(m)) return "The model download failed. Check your connection and try again.";
  return m;
}
