import { describe, expect, it } from "vitest";
import { authConfigured, authEnv, cookieName, freeLimitUserDay, safeCallbackUrl, toClaims, userFromClaims } from "./auth-core";

const S = "x".repeat(32);

describe("safeCallbackUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeCallbackUrl("/search?q=gdp#a")).toBe("/search?q=gdp#a");
  });
  it.each(["/a/../..//evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "evil", "/a\nb", "/api/auth/signout", "", null, undefined])("rejects %s", (v) => {
    expect(safeCallbackUrl(v as string)).toBe("/");
  });
});

describe("userFromClaims", () => {
  it("maps sub/name/email/picture", () => {
    expect(userFromClaims({ sub: "1", name: "A", email: "a@x.com", email_verified: true, picture: "p", aud: "secret" })).toEqual({ id: "1", name: "A", email: "a@x.com", image: "p" });
  });
  it("drops unverified email and needs a sub", () => {
    expect(userFromClaims({ sub: "1", email: "a@x.com", email_verified: false })?.email).toBeNull();
    expect(userFromClaims({ email: "a@x.com" })).toBeNull();
  });
  it("token claims hold only the four fields", () => {
    expect(Object.keys(toClaims({ id: "1", name: null, email: null, image: null })).sort()).toEqual(["email", "name", "picture", "sub"]);
  });
});

describe("gating", () => {
  it("is inert unless all three env vars are set (secret >= 32 chars)", () => {
    expect(authConfigured({})).toBe(false);
    expect(authConfigured({ AUTH_SECRET: S, AUTH_GOOGLE_ID: "i" })).toBe(false);
    expect(authConfigured({ AUTH_SECRET: "short", AUTH_GOOGLE_ID: "i", AUTH_GOOGLE_SECRET: "s" })).toBe(false);
    expect(authEnv({ AUTH_SECRET: S, AUTH_GOOGLE_ID: "i", AUTH_GOOGLE_SECRET: "s" })).toEqual({ secret: S, clientId: "i", clientSecret: "s", origin: null });
  });
  it("in production needs STATMESH_SITE_URL set and https", () => {
    const base = { AUTH_SECRET: S, AUTH_GOOGLE_ID: "i", AUTH_GOOGLE_SECRET: "s" };
    expect(authConfigured({ ...base, NODE_ENV: "production" })).toBe(false);
    expect(authConfigured({ ...base, NODE_ENV: "production", STATMESH_SITE_URL: "http://localhost:3000" })).toBe(false);
    expect(authConfigured({ ...base, NODE_ENV: "production", STATMESH_SITE_URL: "http://example.com" })).toBe(false);
    expect(authEnv({ ...base, NODE_ENV: "production", STATMESH_SITE_URL: "https://x.example.com/p" })?.origin).toBe("https://x.example.com");
    expect(authEnv({ ...base, NODE_ENV: "development", STATMESH_SITE_URL: "http://localhost:3000" })?.origin).toBe("http://localhost:3000");
    expect(authConfigured({ ...base, NODE_ENV: "development", STATMESH_SITE_URL: "http://example.com" })).toBe(false);
  });
  it("free user limit defaults to 100", () => {
    expect(freeLimitUserDay({})).toBe(100);
    expect(freeLimitUserDay({ STATMESH_FREE_LIMIT_USER_DAY: "250" })).toBe(250);
    expect(freeLimitUserDay({ STATMESH_FREE_LIMIT_USER_DAY: "-1" })).toBe(100);
  });
  it("uses __Host- cookie prefix only on https", () => {
    expect(cookieName(true, "sm_session")).toBe("__Host-sm_session");
    expect(cookieName(false, "sm_session")).toBe("sm_session");
  });
});
