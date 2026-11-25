import { describe, expect, it, vi } from "vitest";
import { clientIp, ipBucket, freeAvailable, freeProviders, hashIp, limitsFrom, memoryStore, quotaPayload, refundTurn, startWithFallback, takeTurn, trimHistory, upstashStore } from "./free";
import { validateConfig } from "./providers";

const on = { STATMESH_ALLOW_SERVER_KEY: "1", STATMESH_FREE_LLM_KEY: "gk" };
const lim = { ipMin: 2, ipDay: 3, globalMin: 4, globalDay: 5 };

describe("availability", () => {
  it("needs both the opt-in and the key", () => {
    expect(freeAvailable(on)).toBe(true);
    expect(freeAvailable({ STATMESH_FREE_LLM_KEY: "gk" })).toBe(false);
    expect(freeAvailable({ STATMESH_ALLOW_SERVER_KEY: "1" })).toBe(false);
    expect(freeAvailable({ STATMESH_ALLOW_SERVER_KEY: "true", STATMESH_FREE_LLM_KEY: "gk" })).toBe(false);
    expect(freeProviders({})).toEqual([]);
  });
  it("uses defaults, then env overrides, with an optional fallback", () => {
    const [p, ...rest] = freeProviders(on);
    expect(p).toMatchObject({ kind: "free", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", apiKey: "gk" });
    expect(rest).toEqual([]);
    const two = freeProviders({ ...on, STATMESH_FREE_LLM_MODEL: "m", STATMESH_FREE_LLM_FALLBACK_KEY: "fk" });
    expect(two[0].model).toBe("m");
    expect(two[1]).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", apiKey: "fk" });
  });
  it("never takes a URL, key or model from the client", () => {
    // The route builds the config from freeProviders() alone; a client config for kind "free" has no input path.
    const client = { kind: "free", baseUrl: "https://evil.example/v1", apiKey: "stolen", model: "x" };
    const [p] = freeProviders(on);
    expect(p.baseUrl).not.toBe(client.baseUrl);
    expect(p.apiKey).not.toBe(client.apiKey);
    expect(p.model).not.toBe(client.model);
    expect(validateConfig(p)).toBeNull();
  });
});

describe("limits", () => {
  it("reads env overrides and ignores junk", () => {
    expect(limitsFrom({})).toEqual({ ipMin: 5, ipDay: 30, ipDaySigned: 90, globalMin: 25, globalDay: 900 });
    expect(limitsFrom({ STATMESH_FREE_LIMIT_IP_MIN: "7", STATMESH_FREE_LIMIT_IP_DAY: "x" })).toMatchObject({ ipMin: 7, ipDay: 30 });
  });
  it("blocks the third turn in a minute per IP, with a resetAt at the minute end", async () => {
    const store = memoryStore(() => 0);
    const o = { store, limits: lim, now: 10_000, env: on };
    expect(await takeTurn("1.1.1.1", o)).toBeNull();
    expect(await takeTurn("1.1.1.1", o)).toBeNull();
    const r = await takeTurn("1.1.1.1", o);
    expect(r).toEqual({ code: "free_quota_exhausted", message: expect.any(String), resetAt: new Date(60_000).toISOString() });
    expect(await takeTurn("2.2.2.2", o)).toBeNull(); // another IP is unaffected
  });
  it("applies the per-IP day cap across minutes", async () => {
    const store = memoryStore(() => 0);
    const at = (m: number) => ({ store, limits: lim, now: m * 60_000, env: on });
    for (let m = 0; m < 3; m++) expect(await takeTurn("1.1.1.1", at(m))).toBeNull();
    const r = await takeTurn("1.1.1.1", at(3));
    expect(r?.resetAt).toBe(new Date(86_400_000).toISOString());
  });
  it("applies the global minute and day caps across IPs", async () => {
    const store = memoryStore(() => 0);
    const o = { store, limits: { ...lim, ipMin: 99, ipDay: 99 }, now: 0, env: on };
    for (let i = 0; i < 4; i++) expect(await takeTurn(`10.0.0.${i}`, o)).toBeNull();
    expect((await takeTurn("10.0.0.9", o))?.code).toBe("free_quota_exhausted");
    // next minute: minute budget is fresh, the day budget (5) has one left
    const o2 = { ...o, now: 120_000 };
    expect(await takeTurn("10.0.0.10", o2)).toBeNull();
    expect((await takeTurn("10.0.0.11", o2))?.resetAt).toBe(new Date(86_400_000).toISOString());
  });
  it("memory counters expire", async () => {
    let t = 0;
    const s = memoryStore(() => t);
    expect(await s("k", 10)).toBe(1);
    expect(await s("k", 10)).toBe(2);
    t = 11_000;
    expect(await s("k", 10)).toBe(1);
  });
  it("talks to Upstash with an INCR+EXPIRE pipeline", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ result: 3 }, { result: 1 }])));
    expect(await upstashStore("https://r.example/", "tok", f as never)("k", 60)).toBe(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://r.example/pipeline");
    expect(JSON.parse(init.body as string)).toEqual([["INCRBY", "k", 1], ["EXPIRE", "k", 60]]);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
});

describe("IP handling", () => {
  const rq = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("prefers x-vercel-forwarded-for and ignores spoofable headers unless trusted", () => {
    expect(clientIp(rq({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }), {})).toBe("9.9.9.9");
    expect(clientIp(rq({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }), {})).toBe("unknown");
    expect(clientIp(rq({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }), { STATMESH_TRUST_PROXY: "1" })).toBe("9.9.9.9");
    expect(clientIp(rq({ "x-real-ip": "2.2.2.2" }), { STATMESH_TRUST_PROXY: "1" })).toBe("2.2.2.2");
    expect(clientIp(rq({}), { STATMESH_TRUST_PROXY: "1" })).toBe("unknown");
  });
  it("buckets IPv6 by /64", () => {
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(ipBucket("2001:DB8:1:2::1"));
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(ipBucket("2001:db8:1:2::1"));
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("::ffff:9.9.9.9")).toBe("9.9.9.9");
    expect(ipBucket("9.9.9.9")).toBe("9.9.9.9");
  });
  it("gives an unidentified client the global limits only", async () => {
    const store = memoryStore(() => 0);
    const o = { store, limits: lim, now: 0, env: on };
    for (let i = 0; i < 4; i++) expect(await takeTurn("unknown", o)).toBeNull(); // ipMin is 2, global 4
    expect((await takeTurn("unknown", o))?.code).toBe("free_quota_exhausted");
  });
  it("a turn blocked by a global cap does not add to the IP count", async () => {
    const store = memoryStore(() => 0);
    const o = { store, limits: { ...lim, globalMin: 1 }, now: 0, env: on };
    expect(await takeTurn("1.1.1.1", o)).toBeNull();
    for (let i = 0; i < 5; i++) expect((await takeTurn("2.2.2.2", o))?.code).toBe("free_quota_exhausted");
    // 2.2.2.2 was never charged: with a roomy global cap it still has its full per-IP budget.
    const roomy = { ...o, limits: lim };
    expect(await takeTurn("2.2.2.2", { ...roomy, now: 60_000 })).toBeNull();
    expect(await takeTurn("2.2.2.2", { ...roomy, now: 60_000 })).toBeNull();
  });
  it("refunds a turn", async () => {
    const store = memoryStore(() => 0);
    const o = { store, limits: { ...lim, ipMin: 1 }, now: 0, env: on };
    expect(await takeTurn("1.1.1.1", o)).toBeNull();
    await refundTurn("1.1.1.1", o);
    expect(await takeTurn("1.1.1.1", o)).toBeNull();
    expect((await takeTurn("1.1.1.1", o))?.code).toBe("free_quota_exhausted");
  });
  it("hashes with a salt and never keeps the raw address", async () => {
    const h = hashIp("9.9.9.9", on);
    expect(h).toMatch(/^[0-9a-f]{24}$/);
    expect(h).not.toContain("9.9.9.9");
    expect(hashIp("9.9.9.9", on)).toBe(h);
    expect(hashIp("9.9.9.9", { ...on, STATMESH_FREE_LIMIT_SALT: "other" })).not.toBe(h);
    const keys: string[] = [];
    await takeTurn("9.9.9.9", { store: async (k) => (keys.push(k), 1), limits: lim, env: on });
    expect(keys.some((k) => k.includes("9.9.9.9"))).toBe(false);
  });
});

describe("fallback", () => {
  const stream = (...parts: Record<string, unknown>[]) => ({ fullStream: (async function* () { yield* parts; })() as AsyncIterable<{ type: string; error?: unknown }> });
  const err429 = { type: "error", error: { statusCode: 429, responseBody: "SECRET provider body" } };
  const collect = async (it: AsyncIterable<unknown>) => { const o: unknown[] = []; for await (const p of it) o.push(p); return o; };
  const ok = async <P extends { type: string }>(r: Promise<{ ok: boolean; stream?: AsyncIterable<P> }>) => collect((await r).stream!);

  it("retries once on the fallback after a 429 before any output", async () => {
    const make = vi.fn((i: number) => (i === 0 ? stream({ type: "start" }, err429) : stream({ type: "start" }, { type: "text-delta", text: "hi" })));
    expect(await ok(startWithFallback(2, make))).toEqual([{ type: "start" }, { type: "text-delta", text: "hi" }]);
    expect(make).toHaveBeenCalledTimes(2);
  });
  it("tries the fallback after a 5xx or a bad key, and logs only index and status", async () => {
    const log = vi.fn();
    expect(await ok(startWithFallback(2, (i) => (i === 0 ? stream({ type: "error", error: { statusCode: 503 } }) : stream({ type: "text-delta" })), log))).toEqual([{ type: "text-delta" }]);
    expect(log).toHaveBeenCalledWith(0, 503);
    expect(await ok(startWithFallback(2, (i) => (i === 0 ? stream({ type: "error", error: { statusCode: 401 } }) : stream({ type: "text-delta" }))))).toEqual([{ type: "text-delta" }]);
  });
  it("is unavailable on a non-retryable error, a thrown network error, or a synchronous throw", async () => {
    expect(await startWithFallback(1, () => stream({ type: "error", error: { statusCode: 401 } }))).toEqual({ ok: false, kind: "unavailable" });
    expect(await startWithFallback(1, () => stream({ type: "error", error: { statusCode: 400 } }))).toEqual({ ok: false, kind: "unavailable" });
    const boom = () => ({ fullStream: (async function* () { throw new Error("ECONNRESET"); })() as AsyncIterable<{ type: string }> });
    expect(await startWithFallback(2, boom)).toEqual({ ok: false, kind: "unavailable" });
    expect(await startWithFallback(1, () => { throw new Error("bad config"); })).toEqual({ ok: false, kind: "unavailable" });
  });
  it("is quota only when every provider hit a 429/5xx", async () => {
    expect(await startWithFallback(2, () => stream(err429))).toEqual({ ok: false, kind: "quota" });
    expect(await startWithFallback(1, () => stream(err429))).toEqual({ ok: false, kind: "quota" });
    expect(await startWithFallback(2, (i) => stream(i ? err429 : { type: "error", error: { statusCode: 401 } }))).toEqual({ ok: false, kind: "unavailable" });
  });
});

describe("payload and history", () => {
  it("has the quota contract and no provider detail", () => {
    const p = quotaPayload(new Date("2026-01-01T00:00:00Z"));
    expect(Object.keys(p).sort()).toEqual(["code", "message", "resetAt"]);
    expect(p).toMatchObject({ code: "free_quota_exhausted", resetAt: "2026-01-01T00:00:00.000Z" });
  });
  it("trims history to the last messages, starting at a user turn", () => {
    const m = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }) as never);
    const t = trimHistory(m, 5);
    expect(t.length).toBeLessThanOrEqual(5);
    expect(t[0].role).toBe("user");
    expect(t.at(-1)).toBe(m.at(-1));
  });
  it("never starts with a tool message and keeps the last user message", () => {
    const u = { role: "user", content: "q" } as never;
    const tool = { role: "tool", content: [] } as never;
    const a = { role: "assistant", content: "a" } as never;
    const m = [u, a, tool, a, tool, a, tool, a];
    const t = trimHistory(m, 3); // the window holds no user message
    expect(t[0]).toBe(u);
    expect(trimHistory([a, tool, u, a, tool], 2)).toEqual([u, a, tool]);
  });
  it("falls back to memory quickly when Upstash hangs", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("timeout")))));
    const t0 = Date.now();
    await expect(upstashStore("https://r.example", "t", f as never)("k", 60)).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});

describe("signed-in user quota", () => {
  const o = (store: ReturnType<typeof memoryStore>, user?: { id: string; day: number }) => ({ store, limits: { ...lim, ipMin: 100, ipDay: 1, globalDay: 1000 }, now: 10_000, env: on, user });
  it("keys the day on the user, not the IP, with the higher limit", async () => {
    const store = memoryStore(() => 0);
    const u = { id: "google-sub-123", day: 3 };
    // ipDay is 1, yet a user gets 3 turns, from different IPs
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) expect(await takeTurn(ip, o(store, u))).toBeNull();
    expect((await takeTurn("4.4.4.4", o(store, u)))?.code).toBe("free_quota_exhausted");
    expect(await takeTurn("5.5.5.5", o(store, { id: "other", day: 3 }))).toBeNull();
  });
  it("signed-in users keep a larger per-IP daily cap, rolled back with the rest", async () => {
    const store = memoryStore(() => 0);
    const opts = (id: string) => o(store, { id, day: 50 }); // ipDay 1 -> signed cap 3 (default 3x)
    for (const id of ["a", "b", "c"]) expect(await takeTurn("1.1.1.1", opts(id))).toBeNull();
    expect((await takeTurn("1.1.1.1", opts("d")))?.code).toBe("free_quota_exhausted");
    // the blocked turn rolled back its user bucket
    expect(await takeTurn("2.2.2.2", opts("d"))).toBeNull();
    await refundTurn("1.1.1.1", opts("c"));
    expect(await takeTurn("1.1.1.1", opts("e"))).toBeNull();
    expect(limitsFrom({ STATMESH_FREE_LIMIT_IP_DAY: "10" }).ipDaySigned).toBe(30);
    expect(limitsFrom({ STATMESH_FREE_LIMIT_IP_DAY_SIGNED: "7" }).ipDaySigned).toBe(7);
  });
  it("clamps the per-user day to 10% of the global day", async () => {
    const store = memoryStore(() => 0);
    const opts = { store, limits: { ...lim, ipMin: 100, ipDay: 100, ipDaySigned: 100, globalDay: 20 }, now: 10_000, env: on, user: { id: "u", day: 1000 } };
    expect(await takeTurn("1.1.1.1", opts)).toBeNull();
    expect(await takeTurn("1.1.1.1", opts)).toBeNull();
    expect((await takeTurn("1.1.1.1", opts))?.code).toBe("free_quota_exhausted");
  });
  it("signed-out behaviour is unchanged (per-IP daily)", async () => {
    const store = memoryStore(() => 0);
    expect(await takeTurn("1.1.1.1", o(store))).toBeNull();
    expect((await takeTurn("1.1.1.1", o(store)))?.code).toBe("free_quota_exhausted");
  });
  it("never stores the raw user id, and refunds the user bucket", async () => {
    const keys: string[] = [];
    const store = async (k: string, _t: number, d = 1) => (keys.push(k), d);
    const u = { id: "google-sub-123", day: 3 };
    await takeTurn("1.1.1.1", { ...o(memoryStore()), store, user: u });
    expect(keys.some((k) => k.includes("google-sub-123"))).toBe(false);
    expect(keys.some((k) => k.startsWith("sm:free:u:"))).toBe(true);
    expect(keys.some((k) => k.includes(":ip:") && k.includes(":d:"))).toBe(true);
    const real = memoryStore(() => 0);
    const one = { id: "x", day: 1 };
    await takeTurn("1.1.1.1", o(real, one));
    await refundTurn("1.1.1.1", o(real, one));
    expect(await takeTurn("1.1.1.1", o(real, one))).toBeNull();
  });
});
