import { describe, expect, it } from "vitest";
import {
  axisMode, alignLines, buildCompare, compareCsv, indexRows, noOverlapMessage, overlaps, parseCompareParam, parseGeoParam,
  resolveCompanion, suggestionsFor, type Line, type Row,
} from "./compare";

const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe("suggestions", () => {
  it("offers fertility, infant, child mortality and population for life expectancy, with the birth-rate note", () => {
    const s = suggestionsFor("Life expectancy at birth, total (years)");
    expect(labels(s)).toEqual(["Fertility rate", "Infant mortality", "Child mortality", "Population"]);
    expect(s[0].note).toBe("No crude birth-rate series is loaded; closest: total fertility rate.");
  });
  it("maps fertility and birth to life expectancy and infant mortality", () => {
    expect(labels(suggestionsFor("Total fertility rate (per woman)"))).toEqual(["Life expectancy", "Infant mortality"]);
    expect(labels(suggestionsFor("Adolescent birth rate"))).toEqual(["Life expectancy", "Infant mortality"]);
  });
  it("maps GDP, inflation, unemployment and CO2 as specified", () => {
    expect(labels(suggestionsFor("GDP per capita"))).toEqual(["Population", "Unemployment", "Inflation"]);
    expect(labels(suggestionsFor("Inflation, consumer prices"))).toEqual(["Policy rate", "Unemployment"]);
    expect(labels(suggestionsFor("Unemployment rate"))).toEqual(["GDP", "Inflation"]);
    expect(labels(suggestionsFor("CO2 emissions per capita"))).toEqual(["Energy use", "GDP"]);
  });
  it("suggests nothing for an unrelated title, and never the title's own concept", () => {
    expect(suggestionsFor("Infant mortality rate")).toEqual([]);
    expect(labels(suggestionsFor("GDP and population"))).not.toContain("Population");
  });
  it("resolves a companion to the first matching 3-part hit that is not excluded and has data", async () => {
    const [fertility] = suggestionsFor("Life expectancy");
    const hits = [
      { id: "who_gho:gho:tfr:IND", title: "Total fertility rate" },
      { id: "who_gho:gho:tfr", title: "Total fertility rate (per woman)" },
      { id: "who_gho:gho:WHS9_95", title: "Total fertility rate, 2000" },
    ];
    const all = async () => true;
    expect((await resolveCompanion(fertility, hits, [], all))?.id).toBe("who_gho:gho:tfr");
    expect((await resolveCompanion(fertility, hits, ["who_gho:gho:tfr"], all))?.id).toBe("who_gho:gho:WHS9_95");
    // The first match has no observations loaded: the next one is used.
    expect((await resolveCompanion(fertility, hits, [], async (id) => id === "who_gho:gho:WHS9_95"))?.id).toBe("who_gho:gho:WHS9_95");
    // Nothing with data: undefined, so the picker shows the note instead.
    expect(await resolveCompanion(fertility, hits, [], async () => false)).toBeUndefined();
    expect(await resolveCompanion(fertility, [{ id: "a:b:c:IND", title: "Total fertility rate" }], [], all)).toBeUndefined();
  });
});

describe("URL params", () => {
  it("keeps at most 3 series and reports the extra as tooMany", () => {
    const r = parseCompareParam("a:b:c1,a:b:c2,a:b:c3,a:b:c4", "x:y:z");
    expect(r.ids).toEqual(["a:b:c1", "a:b:c2", "a:b:c3"]);
    expect(r.tooMany).toBe(true);
  });
  it("rejects bad ids, drops self and duplicates", () => {
    const r = parseCompareParam("owid:grapher:infant-mortality, owid:grapher:infant-mortality, x:y:z, bad id, a:b, a:b:c:IND, a:b:c'; drop", "owid:grapher:life-expectancy");
    expect(r.ids).toEqual(["owid:grapher:infant-mortality", "x:y:z"]);
    expect(r.rejected).toEqual(["bad id", "a:b", "a:b:c:IND", "a:b:c'; drop"]);
    expect(r.tooMany).toBe(false);
  });
  it("returns nothing for an empty or missing param", () => {
    expect(parseCompareParam(undefined, "a:b:c").ids).toEqual([]);
    expect(parseCompareParam("", "a:b:c").ids).toEqual([]);
  });
  it("keeps only available countries, at most 4, and falls back to the default", () => {
    expect(parseGeoParam("IND,XXX,USA,IND", ["IND", "USA", "FRA"], ["FRA"])).toEqual(["IND", "USA"]);
    expect(parseGeoParam("A,B,C,D,E", ["A", "B", "C", "D", "E"], [])).toEqual(["A", "B", "C", "D"]);
    expect(parseGeoParam("nope", ["IND", "USA"], ["USA"])).toEqual(["USA"]);
    expect(parseGeoParam(undefined, ["IND"], ["IND"])).toEqual(["IND"]);
  });
});

const line = (key: string, unit: string, freq: string | null, points: [string, number][], label = key): Line => ({
  key, label, unit, freq, points: points.map(([t, v]) => ({ t, v })),
});

describe("units and axes", () => {
  it("one unit: single axis; two: dual; more than two: index", () => {
    expect(axisMode(["years"])).toBe("single");
    expect(axisMode(["years", "years"])).toBe("single");
    expect(axisMode(["years", "deaths per 100"])).toBe("dual");
    expect(axisMode(["a", "b", "c"])).toBe("index");
  });
  it("puts the second unit on the right axis when there are two", () => {
    const r = buildCompare([
      line("a", "years", "A", [["2000-01-01", 70], ["2001-01-01", 71]]),
      line("b", "deaths per 100 live births", "A", [["2000-01-01", 3], ["2001-01-01", 2.5]]),
    ]);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.axis).toEqual({ a: "left", b: "right" });
  });
  it("switches to index automatically with more than two units", () => {
    const r = buildCompare([
      line("a", "x", "A", [["2000-01-01", 1], ["2001-01-01", 2]]),
      line("b", "y", "A", [["2000-01-01", 1]]),
      line("c", "z", "A", [["2000-01-01", 1]]),
    ]);
    expect(r.status === "ok" && r.indexed).toBe(true);
  });
});

describe("index normalisation", () => {
  it("sets the first common period to 100", () => {
    const rows: Row[] = [
      { t: "2000-01-01", a: 50, b: 10 }, { t: "2001-01-01", a: 75, b: 20 }, { t: "2002-01-01", a: 100 },
    ];
    const r = indexRows(rows, ["a", "b"]);
    expect(r.base).toBe("2000-01-01");
    expect(r.rows).toEqual([
      { t: "2000-01-01", a: 100, b: 100 }, { t: "2001-01-01", a: 150, b: 200 }, { t: "2002-01-01", a: 200 },
    ]);
  });
  it("guards a zero base instead of dividing by it", () => {
    const rows = [{ t: "2000-01-01", a: 0, b: 4 }, { t: "2001-01-01", a: 3, b: 8 }];
    const r = indexRows(rows, ["a", "b"]);
    expect(r.dropped).toEqual(["a"]);
    expect(r.rows).toEqual([{ t: "2000-01-01", b: 100 }, { t: "2001-01-01", b: 200 }]);
  });
  it("reports no base when no period holds every line", () => {
    expect(indexRows([{ t: "2000-01-01", a: 1 }, { t: "2001-01-01", b: 2 }], ["a", "b"]).base).toBeNull();
  });
});

describe("frequency alignment", () => {
  it("keeps periods when all lines share one frequency", () => {
    const r = alignLines([line("a", "u", "A", [["2000-01-01", 1]]), line("b", "u", "A", [["2000-01-01", 2]])]);
    expect(r).toEqual({ rows: [{ t: "2000-01-01", a: 1, b: 2 }], aligned: false, freq: "A" });
  });
  it("averages monthly values per year when frequencies differ and says so", () => {
    const r = alignLines([
      line("annual", "u", "A", [["2000-01-01", 10]]),
      line("monthly", "u", "M", [["2000-01-01", 1], ["2000-02-01", 3], ["2001-01-01", 5]]),
    ]);
    expect(r.aligned).toBe(true);
    expect(r.freq).toBe("A");
    expect(r.rows).toEqual([{ t: "2000", annual: 10, monthly: 2 }, { t: "2001", monthly: 5 }]);
    const b = buildCompare([
      line("annual", "u", "A", [["2000-01-01", 10]]),
      line("monthly", "u", "M", [["2000-01-01", 1]]),
    ]);
    expect(b.status === "ok" && b.aligned).toBe(true);
  });
});

describe("overlap", () => {
  it("explains series whose periods do not meet, instead of an empty chart", () => {
    const lines = [
      line("a", "u", "A", [["1990-01-01", 1], ["2000-01-01", 2]], "Life expectancy, World"),
      line("b", "u", "A", [["2010-01-01", 1], ["2020-01-01", 2]], "Infant mortality, World"),
    ];
    const r = buildCompare(lines);
    expect(r).toEqual({
      status: "no-overlap",
      message: "These series do not overlap in time: Life expectancy, World covers 1990–2000, Infant mortality, World covers 2010–2020.",
    });
    expect(noOverlapMessage(lines)).toBe(r.status === "no-overlap" ? r.message : "");
  });
  it("detects a shared period and treats one line as always drawable", () => {
    expect(overlaps([{ t: "2000", a: 1, b: 2 }], ["a", "b"])).toBe(true);
    expect(overlaps([{ t: "2000", a: 1 }], ["a", "b"])).toBe(false);
    expect(overlaps([{ t: "2000", a: 1 }], ["a"])).toBe(true);
  });
});

describe("CSV export", () => {
  it("writes the drawn table with a period column and escaped labels", () => {
    expect(compareCsv([{ t: "2000", a: 1.5 }, { t: "2001", a: 2, b: 3 }], ["a", "b"], ["Life, expectancy", "B"]))
      .toBe('period,"Life, expectancy",B\r\n2000,1.5,\r\n2001,2,3\r\n');
  });
});
