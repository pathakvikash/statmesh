import { describe, expect, it } from "vitest";
import { IN_STATES } from "./in-states";
import { findGeo } from "./sql-geo";

const geos = [{ code: "IND", name: "India" }, { code: "IDN", name: "Indonesia" }, { code: "AUT", name: "Austria" }, ...IN_STATES];

describe("findGeo", () => {
  it("never matches partial text", () => {
    for (const t of ["Indo", "Indon", "Aus", "Niger", ""]) expect(findGeo(geos, t), t).toBeUndefined();
  });
  it("matches exact name or code", () => {
    expect(findGeo(geos, " indonesia ")?.code).toBe("IDN");
    expect(findGeo(geos, "IND")?.code).toBe("IND");
    expect(findGeo(geos, "Maharashtra")?.code).toBe("IN-MH");
  });
  it("has the Indian states", () => {
    expect(IN_STATES.length).toBe(36);
    expect(IN_STATES.every((s) => /^IN-[A-Z]{2}$/.test(s.code))).toBe(true);
  });
});
