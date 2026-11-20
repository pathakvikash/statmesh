import { describe, expect, it } from "vitest";
import { describeProviderError, describeToolError } from "./errors";

const apiErr = (statusCode: number) => Object.assign(new Error("provider said no"), { statusCode });

describe("describeProviderError", () => {
  it("gives a plain reason for each status", () => {
    expect(describeProviderError(apiErr(401))).toMatch(/rejected the API key \(HTTP 401\)/);
    expect(describeProviderError(apiErr(403))).toMatch(/API key/);
    expect(describeProviderError(apiErr(404))).toMatch(/Model not found/);
    expect(describeProviderError(apiErr(429))).toMatch(/rate limiting/);
    expect(describeProviderError(apiErr(503))).toMatch(/internal error \(HTTP 503\)/);
    expect(describeProviderError(apiErr(400))).toMatch(/rejected the request \(HTTP 400\)/);
  });
  it("recognises unreachable hosts from the network error text", () => {
    expect(describeProviderError(new Error("connect ECONNREFUSED 127.0.0.1:11434"))).toMatch(/Could not reach/);
    expect(describeProviderError(new TypeError("fetch failed"))).toMatch(/Could not reach/);
  });
  it("falls back to a generic line without echoing unknown text", () => {
    expect(describeProviderError(new Error("boom"))).toBe("The model provider returned an error.");
    expect(describeProviderError(undefined)).toBe("The model provider returned an error.");
  });
});

describe("describeToolError", () => {
  it("keeps the tool's own message", () => {
    expect(describeToolError(new Error("Index is down"))).toBe("Index is down");
    expect(describeToolError("text")).toBe("text");
  });
  it("uses a fixed line when there is no message", () => {
    expect(describeToolError(new Error("  "))).toBe("The tool call failed.");
    expect(describeToolError({})).toBe("The tool call failed.");
  });
});
