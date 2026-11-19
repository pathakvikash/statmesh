// Wire format of POST /chat/api: newline-delimited JSON, one ChatEvent per line.
export type ChatEvent =
  | { t: "text"; text: string }
  | { t: "call"; id: string; name: string; input: unknown }
  | { t: "result"; id: string; name: string; output: unknown }
  | { t: "error"; message: string };

/** MCP tool outputs arrive as {structuredContent} or {content:[{type:"text",text:json}]}; return the payload. */
export function unwrapToolOutput(o: unknown): unknown {
  if (!o || typeof o !== "object") return o;
  const r = o as { structuredContent?: unknown; content?: { type?: string; text?: string }[]; isError?: boolean };
  const text = Array.isArray(r.content) ? r.content.map((c) => c.text ?? "").join("") : undefined;
  if (r.isError) return { error: text ?? "tool error" };
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (text !== undefined) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return o;
}

export const encodeEvent = (e: ChatEvent) => JSON.stringify(e) + "\n";

/** Split a streamed buffer into complete events plus the unfinished tail. */
export function decodeEvents(buf: string): { events: ChatEvent[]; rest: string } {
  const lines = buf.split("\n");
  const rest = lines.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      events.push(JSON.parse(l));
    } catch {
      /* skip a corrupt line */
    }
  }
  return { events, rest };
}
