import { describe, expect, it } from "vitest";
import { authorizeUrl, b64url, callbackUrl, challengeFor, parseCallback, parseKeyResponse } from "./openrouter-oauth";

describe("openrouter oauth", () => {
  it("S256 challenge matches the RFC 7636 vector", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("base64url has no padding or +/", () => {
    expect(b64url(new Uint8Array([251, 255, 254]))).toBe("-__-");
  });
  it("callback is the same origin with a fixed path only", () => {
    expect(callbackUrl("https://statmesh.example/chat?x=1#y")).toBe("https://statmesh.example/chat");
    expect(callbackUrl("http://localhost:3000")).toBe("http://localhost:3000/chat");
    expect(callbackUrl("http://evil.example")).toBeNull();
    expect(callbackUrl("javascript:alert(1)")).toBeNull();
  });
  it("authorize URL carries S256 and state", () => {
    const u = new URL(authorizeUrl("https://a.example/chat", "CH", "ST"));
    expect(u.origin + u.pathname).toBe("https://openrouter.ai/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({ callback_url: "https://a.example/chat", code_challenge: "CH", code_challenge_method: "S256", state: "ST" });
  });
  it("checks state", () => {
    expect(parseCallback("?code=abc&state=S", "S")).toEqual({ kind: "code", code: "abc" });
    expect(parseCallback("?code=abc&state=X", "S").kind).toBe("error");
    expect(parseCallback("?code=abc", "S").kind).toBe("error");
    expect(parseCallback("?code=abc&state=S", null).kind).toBe("error");
    expect(parseCallback("?q=hi", "S")).toEqual({ kind: "none" });
    expect(parseCallback("?q=hi", null)).toEqual({ kind: "none" });
    expect(parseCallback("?state=S", "S").kind).toBe("error"); // denied: no code
  });
  it("parses the exchange response", () => {
    expect(parseKeyResponse(200, { key: " sk-or-1 " })).toEqual({ key: "sk-or-1" });
    expect(parseKeyResponse(200, {})).toHaveProperty("error");
    expect(parseKeyResponse(200, null)).toHaveProperty("error");
    expect(parseKeyResponse(403, { key: "k" })).toHaveProperty("error");
    expect(parseKeyResponse(500, { error: "x sk-secret" })).toEqual({ error: "Could not get a key from OpenRouter. Try again." });
  });
});
