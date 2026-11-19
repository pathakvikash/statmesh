import { describe, expect, it } from "vitest";
import { citationLine, formatPeriod, formatValue, seriesHref } from "./format";

describe("format", () => {
  it("keeps the unit with the value", () => {
    expect(formatValue(1234.5, "USD", 6)).toBe("1,234.5 million USD");
    expect(formatValue(null, "USD")).toBe("n/a");
  });
  it("formats periods", () => {
    expect(formatPeriod("2020-01-01", "2020-12-31")).toBe("2020-01-01 to 2020-12-31");
    expect(formatPeriod("2020-01-01", "2020-01-01")).toBe("2020-01-01");
  });
  it("builds a citation line", () => {
    const c = { attribution: "Source: ILO", source_name: "ILO", licence_name: "CC-BY-4.0", retrieved_at: "2026-01-02T00:00:00Z" };
    expect(citationLine(c as never)).toBe("Source: ILO, licence CC-BY-4.0, retrieved 2026-01-02");
  });
  it("encodes ids per segment", () => {
    expect(seriesHref("a:b/c:IND")).toBe("/series/a%3Ab/c%3AIND");
  });
});
