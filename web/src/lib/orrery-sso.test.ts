import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { ssoTarget, verifyHandoff } from "./orrery-sso";

const secret = "test-secret-not-real";
const env = { ORRERY_APP_SECRET: secret };
const key = new TextEncoder().encode(secret);
const mk = (claims: Record<string, unknown> = {}, over: { secret?: string; exp?: number; aud?: string } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: "sso", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("orrery")
    .setAudience(over.aud ?? "statmesh")
    .setIssuedAt(now)
    .setExpirationTime(over.exp ?? now + 60)
    .setJti(crypto.randomUUID())
    .sign(over.secret ? new TextEncoder().encode(over.secret) : key);
};

describe("verifyHandoff", () => {
  it("accepts a good token once (single use)", async () => {
    const t = await mk();
    expect(await verifyHandoff(t, env)).toBe(true);
    expect(await verifyHandoff(t, env)).toBe(false);
  });
  it("rejects wrong secret, aud, purpose, expiry, missing secret/token", async () => {
    expect(await verifyHandoff(await mk({}, { secret: "other" }), env)).toBe(false);
    expect(await verifyHandoff(await mk({}, { aud: "x" }), env)).toBe(false);
    expect(await verifyHandoff(await mk({ purpose: "chat" }), env)).toBe(false);
    expect(await verifyHandoff(await mk({ purpose: undefined }), env)).toBe(false); // a service token is not a handoff
    expect(await verifyHandoff(await mk({}, { exp: Math.floor(Date.now() / 1000) - 120 }), env)).toBe(false);
    expect(await verifyHandoff(await mk({}, { exp: Math.floor(Date.now() / 1000) + 3600 }), env)).toBe(false);
    expect(await verifyHandoff(await mk(), {})).toBe(false);
    expect(await verifyHandoff(null, env)).toBe(false);
  });
  it("rejects alg none", async () => {
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const t = `${b({ alg: "none" })}.${b({ purpose: "sso", iss: "orrery", aud: "statmesh", iat: now, exp: now + 60, jti: "z" })}.`;
    expect(await verifyHandoff(t, env)).toBe(false);
  });
});

describe("ssoTarget", () => {
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", null])("rejects %s", (v) => expect(ssoTarget(v)).toBe("/"));
  it("keeps same-origin paths", () => expect(ssoTarget("/sql?sql=select%201&run=1")).toBe("/sql?sql=select%201&run=1"));
});
