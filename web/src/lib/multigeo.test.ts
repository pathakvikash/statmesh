import { describe, expect, it } from "vitest";
import { chartMode, defaultGeos, geoNoun, geoSeriesSql, headlineLabel, isSubnational, isMultiGeoKey, keyMatchSql, pickHeadline, periodsFromRows, rankBars, sparkOf, widen } from "./multigeo";

describe("3-part key matching", () => {
  it("recognises 3-part keys only", () => {
    expect(isMultiGeoKey("owid:grapher:life-expectancy")).toBe(true);
    expect(isMultiGeoKey("owid:grapher:life-expectancy:IND")).toBe(false);
  });
  it("matches by prefix with trailing colon, never LIKE wildcards, and escapes quotes", () => {
    expect(keyMatchSql("series_id", ["a:b:c_d%", "x:y:it's"])).toBe("starts_with(series_id, 'a:b:c_d%:') OR starts_with(series_id, 'x:y:it''s:')");
    expect(keyMatchSql("series_id", [])).toBe("false");
    expect(geoSeriesSql("a:b:c", "A", "{}", ["region:WLD"])).toContain("geo IN ('region:WLD')");
  });
});

const rows = (t: string, vs: Record<string, number>) => Object.entries(vs).map(([geo, v]) => ({ geo, t, v }));
describe("headline selection", () => {
  it("prefers the World aggregate", () => {
    const p = periodsFromRows([...rows("2020", { "region:WLD": 70, IND: 1, USA: 3 }), ...rows("2021", { "region:WLD": 71, IND: 2 })]);
    const h = pickHeadline(p)!;
    expect(h).toMatchObject({ kind: "world", value: 71, period: "2021" });
    expect(headlineLabel(h, (g) => g)).toBe("World");
    expect(sparkOf(p).kind).toBe("world");
  });
  it("falls back to the median of the best-covered latest period, with a country count", () => {
    const p = periodsFromRows([...rows("2019", { A: 1, B: 2, C: 10, D: 20 }), ...rows("2020", { A: 99 })]);
    const h = pickHeadline(p)!;
    expect(h).toMatchObject({ kind: "median", value: 6, period: "2019", count: 4 });
    expect(headlineLabel(h, (g) => g)).toBe("4 countries");
    expect(sparkOf(p).kind).toBe("bars"); // 2 periods only
  });
  it("labels a lone geo by name and uses median-over-time with 3+ periods", () => {
    const p = periodsFromRows(["2018", "2019", "2020"].map((t, i) => ({ geo: "IND", t, v: i })));
    const h = pickHeadline(p, "IND")!;
    expect(headlineLabel(h, () => "India")).toBe("India");
    expect(sparkOf(p)).toMatchObject({ kind: "median", points: [{ t: "2018", v: 0 }, { t: "2019", v: 1 }, { t: "2020", v: 2 }] });
  });
  it("returns null with no data", () => expect(pickHeadline([])).toBeNull());
});

describe("chart choice", () => {
  it("ranks bars for <=3 periods, lines otherwise", () => {
    expect([1, 3, 4, 300].map(chartMode)).toEqual(["bars", "bars", "lines", "lines"]);
  });
  it("defaults to World plus the 4 highest latest countries", () => {
    const latest = [
      { geo: "region:WLD", v: 5, lp: "2023" }, { geo: "A", v: 9, lp: "2023" }, { geo: "B", v: 8, lp: "2023" }, { geo: "C", v: 7, lp: "2023" },
      { geo: "D", v: 6, lp: "2023" }, { geo: "E", v: 1, lp: "2023" }, { geo: "OLD", v: 100, lp: "1990" },
    ];
    expect(defaultGeos(latest)).toEqual(["region:WLD", "A", "B", "C", "D"]);
  });
  it("ranks top/bottom with a name filter and widens long rows", () => {
    const r = [{ name: "Chad", v: 3 }, { name: "Cuba", v: 1 }, { name: "Peru", v: 2 }];
    expect(rankBars(r, "top", "", 2).map((x) => x.name)).toEqual(["Chad", "Peru"]);
    expect(rankBars(r, "bottom", "c", 5).map((x) => x.name)).toEqual(["Cuba", "Chad"]);
    expect(widen([{ geo: "A", t: "2", v: 1 }, { geo: "B", t: "1", v: 2 }, { geo: "B", t: "2", v: 3 }])).toEqual([{ t: "1", B: 2 }, { t: "2", A: 1, B: 3 }]);
  });
});

describe("World-only periods and headline/spark agreement", () => {
  it("keeps periods that have only a World (or region) value", () => {
    const p = periodsFromRows([...rows("2019", { "region:WLD": 7, "region:EU": 3 }), ...rows("2020", { "region:WLD": 8, A: 1 })]);
    expect(p).toEqual([{ t: "2019", med: null, n: 0, w: 7 }, { t: "2020", med: 1, n: 1, w: 8 }]);
    expect(pickHeadline(p)).toMatchObject({ kind: "world", value: 8, period: "2020" });
  });
  it("never trends the median under a World headline", () => {
    const p = periodsFromRows([...["2017", "2018", "2019"].flatMap((t) => rows(t, { A: 1, B: 3 })), ...rows("2019", { "region:WLD": 5 })]);
    expect(pickHeadline(p)!.kind).toBe("world");
    expect(sparkOf(p).kind).toBe("bars");
  });
});

describe("geography noun", () => {
  it("says states/regions for subnational codes, countries for ISO3", () => {
    expect(isSubnational(["US-CA", "US-NY", "USA"])).toBe(true);
    expect(isSubnational(["IND", "USA", "US-CA"])).toBe(false);
    expect(geoNoun(true, 5)).toBe("states/regions");
    expect(geoNoun(false, 1)).toBe("country");
    expect(headlineLabel({ kind: "median", value: 1, period: "2020", count: 51 }, (g) => g, true)).toBe("51 states/regions");
  });
});

import { medianLabel, withMedian } from "./multigeo";
describe("median line", () => {
  it("labels with the country count", () => {
    expect(medianLabel(181)).toBe("Median of 181 countries (computed)");
    expect(medianLabel(1)).toBe("Median of 1 country (computed)");
    expect(medianLabel(30, true)).toBe("Median of 30 states/regions (computed)");
    expect(medianLabel(1, true)).toBe("Median of 1 state/region (computed)");
  });
  it("adds the median only at the chart's own periods", () => {
    const rows = withMedian([{ t: "2019" }, { t: "2020" }], [{ t: "2020", med: 5 }, { t: "2021", med: 6 }], "m");
    expect(rows).toEqual([{ t: "2019" }, { t: "2020", m: 5 }]);
  });
});

describe("geoSeriesSql unit filter", () => {
  it("is absent by default and filters unit and unit_mult when given (through sqlLiteral)", () => {
    expect(geoSeriesSql("a:b:c", "A", "{}")).not.toContain("unit_mult");
    const q = geoSeriesSql("a:b:c", "A", "{}", undefined, undefined, { unit: "USD'x", mult: 1000 });
    expect(q).toContain("unit = 'USD''x'");
    expect(q).toContain("unit_mult = 1000");
    expect(geoSeriesSql("a:b:c", "A", "{}", undefined, undefined, { unit: null, mult: null })).toContain("unit IS NULL AND unit_mult IS NULL");
  });
});

import { headlineText } from "./multigeo";
describe("headlineText", () => {
  it("labels a computed median", () => {
    expect(headlineText({ kind: "median", value: 1, period: "2020", count: 51 }, (g) => g)).toBe("Median of 51 countries (computed)");
    expect(headlineText({ kind: "world", value: 1, period: "2020", count: 1 }, (g) => g)).toBe("World");
  });
});
