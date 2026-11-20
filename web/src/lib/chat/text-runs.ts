import type { ChatEvent } from "./events";

/**
 * Consecutive text events are one run: the model streams one chunk per token, and each chunk
 * must not become its own block. A tool call, result, chart or error starts a new run.
 * Chunks are joined as they are, so leading and trailing spaces survive.
 */
export function mergeTextRuns(events: ChatEvent[]): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const e of events) {
    if (e.t === "text") {
      if (!e.text) continue;
      const last = out[out.length - 1];
      if (last?.t === "text") out[out.length - 1] = { t: "text", text: last.text + e.text };
      else out.push({ t: "text", text: e.text });
    } else out.push(e);
  }
  return out;
}
