import { describe, expect, it } from "vitest";
import { buildSharePayload, createShare, shareUrl } from "./share";
import type { ChatEvent } from "./events";

describe("share", () => {
  it("sends only whitelisted event fields, never config or keys", () => {
    const ev = [
      { t: "text", text: "hi", apiKey: "sk-secret" },
      { t: "call", id: "1", name: "run_sql", input: { sql: "select 1" }, config: { apiKey: "sk-secret" } },
      { t: "result", id: "1", name: "run_sql", output: { rows: [] } },
    ] as unknown as ChatEvent[];
    const p = buildSharePayload("q?", ev);
    expect(Object.keys(p)).toEqual(["question", "events"]);
    expect(JSON.stringify(p)).not.toContain("sk-secret");
    expect(p.events).toHaveLength(3);
  });

  it("builds the public url", () => {
    expect(shareUrl("https://x.org/", "abc")).toBe("https://x.org/a/abc");
  });

  it("maps statuses to messages and returns the id", async () => {
    const f = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const p = buildSharePayload("q", []);
    expect(await createShare(p, f(200, { id: "Zm9vYmFyYmF6" }))).toBe("Zm9vYmFyYmF6");
    await expect(createShare(p, f(413, { detail: "x" }))).rejects.toThrow("too large");
    await expect(createShare(p, f(404, { detail: "x" }))).rejects.toThrow("turned off");
  });
});
