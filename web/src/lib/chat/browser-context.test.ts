import { describe, expect, it } from "vitest";
import { memoryStore } from "./free";
import { CTX_LIMIT, allow } from "./browser-context";

const req = (h: Record<string, string> = {}) => new Request("http://x/api/chat/context?q=a", { headers: h });

describe("context rate limit", () => {
  it("limits callers without a trusted IP through one shared bucket", async () => {
    const store = memoryStore();
    let ok = 0;
    for (let i = 0; i < CTX_LIMIT * 4 + 5; i++) if (await allow(req({ "x-forwarded-for": `1.1.1.${i}` }), store, {})) ok++;
    expect(ok).toBe(CTX_LIMIT * 4);
  });
  it("limits per IP when the proxy is trusted", async () => {
    const store = memoryStore(), env = { STATMESH_TRUST_PROXY: "1" };
    for (let i = 0; i < CTX_LIMIT; i++) expect(await allow(req({ "x-forwarded-for": "2.2.2.2" }), store, env)).toBe(true);
    expect(await allow(req({ "x-forwarded-for": "2.2.2.2" }), store, env)).toBe(false);
    expect(await allow(req({ "x-forwarded-for": "3.3.3.3" }), store, env)).toBe(true);
  });
});
