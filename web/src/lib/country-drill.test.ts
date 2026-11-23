import { describe, expect, it } from "vitest";
import { parseCountryParam, parseSexParam, pickRelated, rankOf, sexOfCode, sexOfTitle, sexSplit, trendOf, withCountry } from "./country-drill";

describe("url params", () => {
  it("parses ?c= and rejects junk", () => {
    expect(parseCountryParam("ind")).toBe("IND");
    expect(parseCountryParam(["CHN", "X"])).toBe("CHN");
    expect(parseCountryParam("region:WLD")).toBeNull();
    expect(parseCountryParam("'; drop")).toBeNull();
    expect(parseCountryParam(undefined)).toBeNull();
  });
  it("defaults sex to all", () => {
    expect(parseSexParam("female")).toBe("female");
    expect(parseSexParam("x")).toBe("all");
    expect(parseSexParam(null)).toBe("all");
  });
  it("keeps other params and never writes geo", () => {
    expect(withCountry("?dim.sex=M&freq=A&c=CHN", "IND", "female")).toBe("?dim.sex=M&freq=A&c=IND&sex=female");
    expect(withCountry("?c=IND&sex=male&compare=a", null)).toBe("?compare=a");
    expect(withCountry("", null)).toBe("");
  });
});

describe("sex detection", () => {
  it("maps stored codes", () => {
    expect(sexOfCode("SEX_MLE")).toBe("male");
    expect(sexOfCode("SEX_FMLE")).toBe("female");
    expect(sexOfCode("SEX_BTSX")).toBe("all");
    expect(sexOfCode("_T")).toBe("all");
    expect(sexOfCode("Y15")).toBeNull();
  });
  it("finds a split only with both male and female", () => {
    expect(sexSplit({ sex: ["SEX_BTSX", "SEX_MLE", "SEX_FMLE"] })).toEqual({ dim: "sex", codes: { all: "SEX_BTSX", male: "SEX_MLE", female: "SEX_FMLE" } });
    expect(sexSplit({ sex: ["T"] })).toBeNull();
    expect(sexSplit({ sex: ["M", "T"] })).toBeNull();
    expect(sexSplit({ age: ["Y15"] })).toBeNull();
    expect(sexSplit({})).toBeNull();
  });
  it("reads the sex from titles without confusing male/female", () => {
    expect(sexOfTitle("Number of female leprosy new cases")).toBe("female");
    expect(sexOfTitle("Percentage of men (15+ years) exposed to second-hand smoke")).toBe("male");
    expect(sexOfTitle("Maternal mortality ratio")).toBe("female");
    expect(sexOfTitle("Population (millions)")).toBeNull();
    expect(sexOfTitle("Ratio of men to women")).toBeNull();
  });
});

describe("pickRelated", () => {
  const cands = [
    { id: "a", title: "Life expectancy at birth (years)", sexes: ["all", "male", "female"] as const },
    { id: "b", title: "Total fertility rate (per woman)" },
    { id: "c", title: "Number of female leprosy new cases" },
    { id: "d", title: "Percentage of men (15+ years) exposed to second-hand smoke" },
    { id: "e", title: "Population (millions)" },
    { id: "f", title: "Adult mortality rate", sexes: ["all", "male"] as const },
  ].map((c) => ({ ...c, sexes: c.sexes ? [...c.sexes] : undefined }));
  it("female: drops men-only, ranks the split and female topics, drops unrelated", () => {
    const p = pickRelated("female", cands);
    expect(p.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(p[0].sex).toBe("female");
    expect(p[1].sex).toBe("title");
  });
  it("male: split series first, then male titles; female-only dropped", () => {
    expect(pickRelated("male", cands).map((x) => x.id)).toEqual(["a", "f", "d"]);
  });
  it("overall picks nothing; limit applies", () => {
    expect(pickRelated("all", cands)).toEqual([]);
    expect(pickRelated("female", cands, 1)).toHaveLength(1);
  });
});

describe("rank and trend", () => {
  it("ranks largest first and handles a missing geo", () => {
    const rows = [{ geo: "A", v: 5 }, { geo: "B", v: 9 }, { geo: "C", v: 1 }];
    expect(rankOf(rows, "A")).toEqual({ rank: 2, of: 3 });
    expect(rankOf(rows, "Z")).toBeNull();
  });
  it("needs two points", () => {
    expect(trendOf([{ t: "2020", v: 1 }])).toBeNull();
    const t = trendOf([{ t: "2019", v: 100 }, { t: "2020", v: 110 }])!;
    expect(t.delta).toBe(10);
    expect(t.pct).toBeCloseTo(10);
    expect(trendOf([{ t: "a", v: 0 }, { t: "b", v: 1 }])!.pct).toBeNull();
  });
});

import { citeLine, drillSelection, relatedBase } from "./country-drill";
describe("drill helpers", () => {
  const split = { dim: "SEX", codes: { all: "T", male: "M", female: "F" } };
  it("Overall pins the all-sexes code; a chosen sex pins its own", () => {
    expect(drillSelection({ age: "Y15" }, split, "all")).toEqual({ sel: { age: "Y15", SEX: "T" }, noData: false });
    expect(drillSelection({}, split, "female").sel).toEqual({ SEX: "F" });
    expect(drillSelection({ SEX: "M" }, split, "all").sel).toEqual({ SEX: "M" });
    expect(drillSelection({}, { dim: "sex", codes: { male: "M", female: "F" } }, "all")).toEqual({ sel: {}, noData: false });
    expect(drillSelection({}, null, "male").noData).toBe(true);
  });
  it("strips a geo from related ids", () => {
    expect(relatedBase("a:b:c:IND")).toBe("a:b:c");
    expect(relatedBase("a:b:c")).toBe("a:b:c");
  });
  it("cites source, dataset and date", () => {
    expect(citeLine({ source_name: "WHO", dataset_id: "GHO", retrieved_at: "2026-11-01T10:00:00Z" })).toBe("WHO / GHO, retrieved 2026-11-01");
    expect(citeLine({ source_name: "WHO", dataset_id: "GHO" })).toBe("WHO / GHO");
  });
});
