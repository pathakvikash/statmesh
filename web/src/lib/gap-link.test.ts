import { describe, expect, it } from "vitest";
import { gapLink } from "./gap-link";

const BASE = "https://github.com/o/r/issues/new";

describe("gapLink", () => {
  it("builds the prefilled issue url", () => {
    expect(gapLink(BASE, "3d printing")).toBe(`${BASE}?template=data-gap.yml&title=Data%20gap%3A%203d%20printing&labels=data-gap`);
  });
  it("is null when unset, blank query, non-https or unparsable", () => {
    expect(gapLink(undefined, "x")).toBeNull();
    expect(gapLink("", "x")).toBeNull();
    expect(gapLink(BASE, "  ")).toBeNull();
    expect(gapLink("http://github.com/o/r/issues/new", "x")).toBeNull();
    expect(gapLink("javascript:alert(1)", "x")).toBeNull();
    expect(gapLink("nope", "x")).toBeNull();
  });
  it("strips credentials, query, hash and trailing slash from the base", () => {
    expect(gapLink("https://u:p@github.com/o/r/issues/new/?a=1#h", "x")?.startsWith(`${BASE}?template=`)).toBe(true);
  });
  it("truncates the query to 80 chars and encodes specials", () => {
    const l = gapLink(BASE, "a&b=c".padEnd(200, "z"))!;
    expect(l).toContain("a%26b%3Dc");
    expect(decodeURIComponent(l.split("title=")[1].split("&")[0])).toBe(`Data gap: ${"a&b=c".padEnd(80, "z")}`);
  });
});
