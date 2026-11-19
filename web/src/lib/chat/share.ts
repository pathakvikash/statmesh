import type { Citation } from "@/lib/format";
import type { ChatEvent } from "./events";

/** What GET /shares/{id} returns. Citations are rebuilt by the server from the catalog. */
export type Share = {
  id: string;
  created_at: string;
  question: string;
  events: ChatEvent[];
  citations: Citation[];
  unavailable: string[];
};

/** Only these event fields are ever sent: the provider config and API key are not events, so they cannot leak. */
export function buildSharePayload(question: string, events: ChatEvent[]) {
  const keep = events.flatMap((e): ChatEvent[] =>
    e.t === "text" ? [{ t: "text", text: e.text }]
    : e.t === "call" ? [{ t: "call", id: e.id, name: e.name, input: e.input }]
    : e.t === "result" ? [{ t: "result", id: e.id, name: e.name, output: e.output }]
    : e.t === "error" ? [{ t: "error", message: e.message }]
    : []);
  return { question, events: keep };
}

export const shareUrl = (origin: string, id: string) => `${origin.replace(/\/$/, "")}/a/${id}`;

const WHY: Record<number, string> = {
  404: "Sharing is turned off on this server.",
  413: "This answer is too large to share.",
  400: "This answer cannot be shared (it contains something that looks like an API key).",
};

/** POST the payload to the web server's /api/share route; resolves to the new share id. */
export async function createShare(payload: ReturnType<typeof buildSharePayload>, doFetch: typeof fetch = fetch): Promise<string> {
  const r = await doFetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await r.json().catch(() => ({}));
  if (r.ok && typeof body.id === "string") return body.id;
  throw new Error(WHY[r.status] ?? body.detail ?? `Could not create the link (${r.status})`);
}
