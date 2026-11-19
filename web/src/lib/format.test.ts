import { describe, expect, it } from "vitest";
import { citationLine, coverageYears, formatCompact, formatPeriod, formatValue, freqLabel, periodLabel, relativeTime, seriesHref, shortSourceName, unitLabel } from "./format";

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
  it("maps frequency codes to words", () => {
    expect(freqLabel("M")).toBe("Monthly");
    expect(freqLabel("s")).toBe("Semiannual");
    expect(freqLabel("X")).toBe("X");
    expect(freqLabel(null)).toBeNull();
  });
  it("describes relative time", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(relativeTime("2026-11-19T01:00:00", now)).toBe("today");
    expect(relativeTime("2026-11-18T10:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-11-09T10:00:00Z", now)).toBe("10 days ago");
    expect(relativeTime("2026-05-19T10:00:00Z", now)).toBe("6 months ago");
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("junk", now)).toBe("");
  });
  it("labels periods and units", () => {
    expect(periodLabel("2022-01-01", "A")).toBe("2022");
    expect(periodLabel("2022-07-01", "Q")).toBe("2022 Q3");
    expect(periodLabel("2022-03-01", "M")).toBe("Mar 2022");
    expect(periodLabel("2022-03-05", "D")).toBe("2022-03-05");
    expect(unitLabel("USD", 6)).toBe("USD, million");
    expect(unitLabel(null, 0)).toBe("");
    expect(unitLabel("PT")).toBe("%");
    expect(unitLabel("368")).toBe("");
    expect(formatCompact(1250000)).toBe("1.25M");
  });
  it("shortens source names", () => {
    expect(shortSourceName("FRED (Federal Reserve Bank of St. Louis)")).toBe("FRED");
    expect(shortSourceName("DBnomics")).toBe("DBnomics");
  });
  it("formats coverage", () => {
    expect(coverageYears("2015-01-01", "2024-12-31")).toBe("2015–2024");
    expect(coverageYears("2020-01-01", "2020-06-01")).toBe("2020");
    expect(coverageYears(null, null)).toBe("");
  });
});
