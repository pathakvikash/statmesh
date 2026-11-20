import { describe, expect, it } from "vitest";
import { coverageText, presets, rangeState, type Preset } from "./range";

const monthly = (y0: number, m0: number, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const k = m0 - 1 + i;
    return `${y0 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
  });
const annual = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${from + i}-01-01`);
const byId = (ps: Preset[]) => Object.fromEntries(ps.map((p) => [p.id, p]));

describe("presets", () => {
  it("monthly over 6 months: only Max is available", () => {
    const p = byId(presets(monthly(2024, 1, 6)));
    expect(p["1Y"]).toMatchObject({ available: false, points: 6 });
    expect(p["5Y"].available).toBe(false);
    expect(p["10Y"].available).toBe(false);
    expect(p.Max).toMatchObject({ available: true, points: 6 });
  });

  it("monthly over 15 years: all presets available with the expected windows", () => {
    const p = byId(presets(monthly(2010, 1, 180)));
    expect(p["1Y"]).toMatchObject({ available: true, points: 12 });
    expect(p["5Y"]).toMatchObject({ available: true, points: 60 });
    expect(p["10Y"]).toMatchObject({ available: true, points: 120 });
    expect(p.Max).toMatchObject({ available: true, points: 180 });
  });

  it("annual over 12 years: 1Y unavailable (one point), 5Y and 10Y available", () => {
    const p = byId(presets(annual(2013, 2024)));
    expect(p["1Y"]).toMatchObject({ available: false, points: 1 });
    expect(p["5Y"]).toMatchObject({ available: true, points: 5 });
    expect(p["10Y"]).toMatchObject({ available: true, points: 10 });
  });

  it("annual over 4 years: 5Y and 10Y unavailable", () => {
    const p = byId(presets(annual(2021, 2024)));
    expect(p["5Y"].available).toBe(false);
    expect(p["10Y"].available).toBe(false);
    expect(p.Max.available).toBe(true);
  });

  it("a single point: only Max is available", () => {
    const p = byId(presets(["2024-06-01"]));
    expect(p.Max).toMatchObject({ available: true, points: 1 });
    expect(p["1Y"].available).toBe(false);
  });

  it("empty input: Max available with no points, the rest unavailable", () => {
    const p = byId(presets([]));
    expect(p.Max).toMatchObject({ available: true, points: 0 });
    expect(p["1Y"].available).toBe(false);
    expect(rangeState([], "5Y").active).toBe("Max");
  });

  it("unsorted input (with repeats) gives the same answer as sorted input", () => {
    const shuffled = [...annual(2013, 2024)].reverse().concat(["2019-01-01"]);
    expect(presets(shuffled)).toEqual(presets(annual(2013, 2024)));
  });
});

describe("rangeState", () => {
  it("falls back to Max when the selected preset is no longer available", () => {
    const short = rangeState(monthly(2024, 1, 6), "5Y");
    expect(short.active).toBe("Max");
    expect(short.from).toBeNull();
  });

  it("keeps the selected preset when it is available and sets its exclusive start", () => {
    const s = rangeState(annual(2013, 2024), "5Y");
    expect(s.active).toBe("5Y");
    expect(s.from).toBe("2019-01-01");
  });
});

describe("coverageText", () => {
  it("names the real first and last period and the point count", () => {
    expect(coverageText(monthly(2024, 1, 6), "M")).toBe("Data: Jan 2024 to Jun 2024 · 6 points");
    expect(coverageText(["2024-06-01"], "M")).toBe("Data: Jun 2024 · 1 point");
    expect(coverageText([], "M")).toBe("");
  });
});
