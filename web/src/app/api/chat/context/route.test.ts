import { beforeEach, describe, expect, it, vi } from "vitest";

const facts = [{ id: "a:b:c", title: "T", source: "S", url: "https://u", value: 1, unit: null, period: "2023", geo: null }];
vi.mock("@/lib/chat/browser-context", () => ({ buildFacts: vi.fn(async () => facts), allow: vi.fn(async () => true) }));
import { allow, buildFacts } from "@/lib/chat/browser-context";
import { GET } from "./route";

const call = (q?: string) => GET(new Request(`http://x/api/chat/context${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));
beforeEach(() => vi.mocked(allow).mockResolvedValue(true));

describe("GET /api/chat/context", () => {
  it("returns {facts} with citation fields and cache headers", async () => {
    const r = await call("unemployment");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ facts });
    expect(r.headers.get("cache-control")).toContain("s-maxage");
  });
  it("needs q", async () => expect((await call()).status).toBe(400));
  it("rate limits", async () => {
    vi.mocked(allow).mockResolvedValue(false);
    expect((await call("x")).status).toBe(429);
  });
  it("maps upstream failure to 502", async () => {
    vi.mocked(buildFacts).mockRejectedValueOnce(new Error("down"));
    expect((await call("x")).status).toBe(502);
  });
});
