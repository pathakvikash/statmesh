// Synthetic fixtures only.
import { describe, expect, it } from "vitest";
import { cagr, computeInsights, insightLines, outliers, rankAmong } from "./insights";

const pts = (vs: number[], start = 2000) => vs.map((v, i) => ({ t: `${start + i}-01-01`, v }));

describe("computeInsights", () => {
  it("handles 0, 1 and 2 points", () => {
    expect(computeInsights([])).toBeNull();
    const one = computeInsights(pts([5]))!;
    expect(one.prev).toBeUndefined();
    expect(one.abs).toBeUndefined();
    const two = computeInsights(pts([4, 5]))!;
    expect(two.abs).toBe(1);
    expect(two.pct).toBe(25);
  });
  it("omits pct when prev is 0", () => {
    const r = computeInsights(pts([0, 3]))!;
    expect(r.abs).toBe(3);
    expect(r.pct).toBeUndefined();
  });
  it("min/max ties resolve to the earliest period", () => {
    const r = computeInsights(pts([2, 9, 1, 9, 1, 5]))!;
    expect(r.max.t).toBe("2001-01-01");
    expect(r.min.t).toBe("2002-01-01");
  });
});

describe("cagr", () => {
  it("computes for positive level series over 1y+", () => expect(cagr(pts([100, 121]) , "USD")!).toBeCloseTo(0.21, 2));
  it("is null for percent/rate units, non-positive values and spans under a year", () => {
    expect(cagr(pts([100, 121]), "%")).toBeNull();
    expect(cagr(pts([100, 121]), "Unemployment rate")).toBeNull();
    expect(cagr(pts([0, 121]), "USD")).toBeNull();
    expect(cagr(pts([-1, 121]), "USD")).toBeNull();
    expect(cagr([{ t: "2020-01-01", v: 1 }, { t: "2020-06-01", v: 2 }], "USD")).toBeNull();
  });
  it("accepts a calendar year (365 days)", () => expect(cagr([{ t: "2001-01-01", v: 100 }, { t: "2002-01-01", v: 110 }], "USD")!).toBeCloseTo(0.1, 2));
  it("is null for basis points, pp, pts, per mille, ratio and a missing unit", () => {
    for (const u of ["basis points", "pp", "pts", "‰", "Debt ratio", "", null, undefined]) expect(cagr(pts([100, 121]), u as string | null | undefined)).toBeNull();
  });
});

describe("outliers", () => {
  it("is null below 12 points", () => expect(outliers(pts([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBeNull());
  it("detects a planted spike", () => {
    const vs = Array.from({ length: 20 }, (_, i) => 100 + i + (i % 2 ? 0.5 : 0));
    vs[10] += 80;
    const o = outliers(pts(vs))!;
    expect(o).toContain("2010-01-01");
  });
  it("flags nothing on a clean line", () => expect(outliers(pts(Array.from({ length: 15 }, (_, i) => i * 2)))).toEqual([]));
});

describe("rankAmong", () => {
  const rows = [{ geo: "IND", v: 5 }, { geo: "USA", v: 9 }, { geo: "VNM", v: 1 }, { geo: "region:WLD", v: 100 }, { geo: "unmapped:X", v: 200 }];
  it("ranks among countries only", () => expect(rankAmong(rows, "IND")).toEqual({ rank: 2, n: 3 }));
  it("is null when only one country exists", () => expect(rankAmong([{ geo: "IND", v: 5 }, { geo: "region:WLD", v: 9 }], "IND")).toBeNull());
  it("is null for a missing or absent geo", () => {
    expect(rankAmong(rows, "FRA")).toBeNull();
    expect(rankAmong(rows, null)).toBeNull();
    expect(rankAmong(rows, "region:WLD")).toBeNull();
  });
});

describe("insightLines", () => {
  it("is empty for 1 point and null", () => {
    expect(insightLines(computeInsights(pts([5])), "A")).toEqual([]);
    expect(insightLines(null)).toEqual([]);
  });
  it("labels every line computed", () => {
    const l = insightLines(computeInsights(pts([4, 5, 7]), "USD"), "A", "USD");
    expect(l.length).toBeGreaterThan(1);
    expect(l.every((x) => x.includes("(computed)"))).toBe(true);
  });
});
