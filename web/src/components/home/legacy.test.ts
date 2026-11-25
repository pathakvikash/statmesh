import { describe, expect, it } from "vitest";
import { orElse, cachedCore } from "@/lib/data";
import { legacyTarget } from "./legacy";

describe("legacyTarget", () => {
  it("sends old /?q= and /?source= links to search with filters carried over", () => {
    expect(legacyTarget(new URLSearchParams("q=gdp"))).toBe("/search?q=gdp");
    expect(legacyTarget(new URLSearchParams("source=worldbank"))).toContain("source=worldbank");
  });
  it("leaves a plain home visit alone", () => {
    expect(legacyTarget(new URLSearchParams(""))).toBeNull();
  });
});

describe("home fallbacks", () => {
  it("orElse returns the fallback when a loader throws", async () => {
    expect(await orElse("x", async () => { throw new Error("api down"); }, [])).toEqual([]);
  });
  it("exports one shared core-indicators cache for strip and graph", () => {
    expect(typeof cachedCore).toBe("function");
  });
});
