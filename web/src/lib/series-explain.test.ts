import { describe, expect, it } from "vitest";
import { explainSeries, seriesQuestions, sparseNote } from "./series-explain";

const d = { title: "Abortion admission per 100 women", source_id: "who/gho: x" };
describe("explainSeries", () => {
  it("builds the full sentence", () => {
    expect(explainSeries(d, { sourceName: "WHO", geoText: "India", freqText: "Annual", unitText: "per 100 women" }).lead)
      .toBe("This series measures Abortion admission per 100 women for India, reported annual in per 100 women. Published by WHO.");
  });
  it("never says undefined when fields are missing", () => {
    for (const o of [{}, { unitText: null }, { geoText: "", freqText: undefined }, { sourceName: "WHO" }]) {
      const r = explainSeries(d, o);
      expect(r.lead + r.facts.join()).not.toMatch(/undefined|null|false/);
    }
    expect(explainSeries(d, {}).lead).toBe("This series measures Abortion admission per 100 women.");
    expect(explainSeries(d, { coverage: "2015–2016", periods: 1 }).facts).toEqual(["Covers 2015–2016", "1 period stored"]);
  });
});
describe("seriesQuestions", () => {
  const labels = (o: Parameters<typeof seriesQuestions>[1]) => seriesQuestions(d, o).map((c) => c.label);
  it("depends on canCompare, hasTrend and unit", () => {
    expect(labels({ canCompare: false, hasTrend: false })).toEqual(["What are the caveats?", "Similar series", "About the source"]);
    expect(labels({ canCompare: true, hasTrend: true, unitText: "%" })).toEqual(["How has it changed?", "What does % mean here?", "What are the caveats?", "Compare", "Similar series", "About the source"]);
  });
  it("keeps freq and dim.* in the compare link", () => {
    const c = seriesQuestions(d, { canCompare: true, hasTrend: false, sp: { freq: "A", "dim.sex": "F", q: "x", tab: "data" } }).find((x) => x.label === "Compare");
    expect(c).toEqual({ label: "Compare", href: "?freq=A&dim.sex=F&tab=compare" });
  });
  it("encodes link chips", () => {
    const hrefs = seriesQuestions(d, { canCompare: false, hasTrend: false }).flatMap((c) => ("href" in c ? [c.href] : []));
    expect(hrefs).toEqual(["/search?q=Abortion%20admission%20per%20100", "/sources/who%2Fgho%3A%20x"]);
  });
});
describe("sparseNote", () => {
  it("states the stored span", () => {
    expect(sparseNote([{ t: "2020-01-01" }, { t: "2021-01-01" }], "A", "WHO")).toBe("Only 2 periods stored (2020–2021). Source: WHO.");
    expect(sparseNote([{ t: "2020-01-01" }], "A", null)).toBe("Only 1 period stored (2020).");
  });
});
