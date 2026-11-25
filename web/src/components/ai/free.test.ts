import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FREE_CONFIG, UNAVAILABLE_TEXT, freeDefault, parseQuota, quotaText } from "./free";
import { QuotaNotice } from "./QuotaNotice";
import type { ProviderConfig } from "@/lib/chat/providers";

const blank: ProviderConfig = { kind: "openai", baseUrl: "", model: "", apiKey: "" };
const o = { stored: false, available: true, serverKey: false };

it("defaults to the free assistant on first load when it is available", () => {
  expect(freeDefault(blank, o)).toBe("free");
});
it("keeps today's behaviour when free is not available", () => {
  expect(freeDefault(blank, { ...o, available: false })).toBeNull();
});
it("keeps a stored usable choice and the local claude CLI", () => {
  expect(freeDefault({ ...blank, apiKey: "k" }, { ...o, stored: true })).toBeNull();
  expect(freeDefault({ ...blank, kind: "claude-cli" }, o)).toBeNull();
  expect(freeDefault({ ...blank, kind: "ollama", model: "m" }, { ...o, stored: true })).toBeNull();
});
it("replaces a stored key-less choice, and drops a stored free choice that is no longer offered", () => {
  expect(freeDefault(blank, { ...o, stored: true })).toBe("free");
  expect(freeDefault(FREE_CONFIG, { ...o, stored: true, available: false })).toBe("blank");
  expect(freeDefault(FREE_CONFIG, { ...o, stored: true })).toBeNull();
});

it("recognises only the free_quota_exhausted 429", () => {
  const body = { code: "free_quota_exhausted", message: "m", resetAt: "2026-11-25T10:00:00Z" };
  expect(parseQuota(429, body)).toEqual({ message: "m", resetAt: body.resetAt });
  expect(parseQuota(429, { error: "x" })).toBeNull();
  expect(parseQuota(500, body)).toBeNull();
  expect(parseQuota(429, null)).toBeNull();
});

it("renders the busy message with a local reset time and a picker button", () => {
  const t = quotaText("2026-11-25T10:05:00Z", "en-US");
  expect(t).toMatch(/^Free assistant is busy \(resets at .+\)\. Add your own key or use a local model\.$/);
  expect(quotaText("nonsense")).toBe("Free assistant is busy. Add your own key or use a local model.");
  const html = renderToStaticMarkup(createElement(QuotaNotice, { resetAt: "2026-11-25T10:05:00Z", onPick: () => {} }));
  expect(html).toContain('role="alert"');
  expect(html).toContain("Free assistant is busy");
  expect(html).toMatch(/<button type="button"[^>]*>Choose another provider<\/button>/);
});

it("never overrides an explicit pick or typed key/model", () => {
  expect(freeDefault(blank, { ...o, chosen: true })).toBeNull();
  expect(freeDefault(blank, { ...o, stored: true, chosen: true })).toBeNull();
  expect(freeDefault(FREE_CONFIG, { ...o, chosen: true, available: false })).toBe("blank");
});

it("handles the 503 free_unavailable body with its own message and the same picker button", () => {
  expect(parseQuota(503, { code: "free_unavailable", error: "x" })).toEqual({ message: UNAVAILABLE_TEXT, unavailable: true });
  expect(parseQuota(503, { error: "x" })).toBeNull();
  expect(UNAVAILABLE_TEXT).toBe("Free assistant is unavailable. Add your own key or use a local model.");
  const html = renderToStaticMarkup(createElement(QuotaNotice, { unavailable: true, onPick: () => {} }));
  expect(html).toContain("Free assistant is unavailable");
  expect(html).not.toContain("busy");
  expect(html).toMatch(/<button type="button"[^>]*>Choose another provider<\/button>/);
});
