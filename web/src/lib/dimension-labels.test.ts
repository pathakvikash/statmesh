import { describe, expect, it } from "vitest";
import { dimensionLabel as L } from "./dimension-labels";

describe("dimensionLabel", () => {
  it("maps sex, age and urbanisation codes", () => {
    expect(L("sex", "F")).toBe("Female");
    expect(L("SEX", "M")).toBe("Male");
    expect(L("sex", "_T")).toBe("Total");
    expect(L("age", "Y15-24")).toBe("15-24 years");
    expect(L("age", "Y_GE65")).toBe("65 years or over");
    expect(L("age", "Y_LT15")).toBe("Under 15 years");
    expect(L("age", "_T")).toBe("Total");
    expect(L("urbanisation", "U")).toBe("Urban");
    expect(L("urbanisation", "R")).toBe("Rural");
  });
  it("labels Y-codes as ages only in age dimensions", () => {
    expect(L("year", "Y2020")).toBe("Y2020");
    expect(L("age", "Y20")).toBe("20 years");
  });
  it("falls back to the raw code", () => {
    expect(L("sex", "XYZ")).toBe("XYZ");
    expect(L("topic", "U")).toBe("U");
    expect(L("topic", "ALL")).toBe("All");
  });
});
