import { describe, expect, it } from "vitest";
import { geoByLabel } from "./lines-drill";

describe("geoByLabel", () => {
  const names = new Map([["JPN", "Japan"], ["CHE", "Switzerland"]]);
  it("matches display names and codes, ignoring padding", () => {
    expect(geoByLabel(" Japan ", ["CHE", "JPN"], names)).toBe("JPN");
    expect(geoByLabel("XYZ", ["XYZ"], names)).toBe("XYZ");
  });
  it("returns null for a label that is not drawn", () => expect(geoByLabel("India", ["JPN"], names)).toBeNull());
});
