import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { signToken, verifyToken, sessionToken, sessionUserId, names } = await import("./auth");

beforeAll(() => {
  Object.assign(process.env, { AUTH_SECRET: "x".repeat(32), AUTH_GOOGLE_ID: "i", AUTH_GOOGLE_SECRET: "s", STATMESH_SITE_URL: "https://site.example.com" });
});

describe("token purpose", () => {
  it("rejects a flow token as a session and a session token as a flow", async () => {
    const flow = (await signToken({ state: "s" }, 60, "flow"))!;
    const session = (await sessionToken({ id: "u1", name: null, email: null, image: null }))!;
    expect(await verifyToken(flow, "flow")).not.toBeNull();
    expect(await verifyToken(flow, "session")).toBeNull();
    expect(await verifyToken(session, "flow")).toBeNull();
    expect((await verifyToken(session, "session"))?.sub).toBe("u1");
  });
});

describe("session cookie", () => {
  it("reads only the __Host- name on https (no plain fallback)", async () => {
    const session = (await sessionToken({ id: "u1", name: null, email: null, image: null }))!;
    const req = (c: string) => new Request("https://site.example.com/", { headers: { cookie: c } });
    expect(names("https://site.example.com").session).toBe("__Host-sm_session");
    expect(await sessionUserId(req(`__Host-sm_session=${session}`))).toBe("u1");
    expect(await sessionUserId(req(`sm_session=${session}`))).toBeNull();
  });
});
