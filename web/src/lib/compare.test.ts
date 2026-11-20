import { describe, expect, it } from "vitest";
import {
  axisMode, alignLines, buildCompare, compareCsv, defaultCompareGeos, indexRows, isSeriesId, noOverlapMessage, overlaps, parseCompareParam, parseGeoParam,
  checkIds, conceptCandidates, isExact, pickSuggestions, planLive, suggestionsFor, LIVE_BUDGET, type Companion, type Concept,
  type Exact, type Hit, type Line, type Row,
} from "./compare";

const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe("suggestions", () => {
  it("lists the exact ids first for life expectancy, then the fertility concept and population, with the birth-rate note", () => {
    const s = suggestionsFor("Life expectancy at birth, total (years)");
    expect(labels(s)).toEqual([
      "Infant mortality", "Child mortality", "Adolescent birth rate (per 1,000 women aged 15-19)", "Fertility rate", "Population",
    ]);
    expect(s.slice(0, 3).every(isExact)).toBe(true);
    expect(s.slice(0, 3).map((c) => (c as Exact).id)).toEqual([
      "owid:grapher:infant-mortality", "owid:grapher:child-mortality-igme", "who_gho:gho:MDG_0000000003",
    ]);
    expect(s.find((c) => c.label === "Fertility rate")?.note).toBe("No crude birth-rate series is loaded; closest: total fertility rate.");
  });
  it("marks only the adolescent birth rate as live", () => {
    const live = suggestionsFor("Life expectancy").filter((c) => isExact(c) && c.live);
    expect(labels(live)).toEqual(["Adolescent birth rate (per 1,000 women aged 15-19)"]);
  });
  it("maps fertility and birth to the exact ids first, then life expectancy", () => {
    expect(labels(suggestionsFor("Total fertility rate (per woman)"))).toEqual([
      "Infant mortality", "Child mortality", "Adolescent birth rate (per 1,000 women aged 15-19)", "Life expectancy",
    ]);
    // The series' own id is not offered back to it.
    expect(labels(suggestionsFor("Adolescent birth rate"))).toEqual(["Infant mortality", "Child mortality", "Life expectancy"]);
  });
  it("accepts only 3-part series ids", () => {
    expect(isSeriesId("who_gho:gho:MDG_0000000003")).toBe(true);
    expect(isSeriesId("who_gho:gho")).toBe(false);
    expect(isSeriesId("who_gho:gho:x/../y")).toBe(false);
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
  it("uses at most the first 2 matching 3-part hits per concept, skipping excluded ids", () => {
    const fertility = suggestionsFor("Life expectancy").find((c): c is Concept => !isExact(c) && c.label === "Fertility rate")!;
    const hits: Hit[] = [
      { id: "who_gho:gho:tfr:IND", title: "Total fertility rate", meta: "" },
      { id: "who_gho:gho:tfr", title: "Total fertility rate (per woman)", meta: "" },
      { id: "who_gho:gho:WHS9_95", title: "Total fertility rate, 2000", meta: "" },
      { id: "who_gho:gho:WHS9_96", title: "Total fertility rate, 2001", meta: "" },
    ];
    expect(conceptCandidates(fertility, hits, []).map((h) => h.id)).toEqual(["who_gho:gho:tfr", "who_gho:gho:WHS9_95"]);
    expect(conceptCandidates(fertility, hits, ["who_gho:gho:tfr"]).map((h) => h.id)).toEqual(["who_gho:gho:WHS9_95", "who_gho:gho:WHS9_96"]);
  });
  it("picks a concept's first candidate that has rows, and an exact id only when it has rows", () => {
    const companions = suggestionsFor("Life expectancy");
    const fertility = companions.find((c): c is Concept => !isExact(c) && c.label === "Fertility rate")!;
    const hits = new Map<Companion, Hit[]>([[fertility, [
      { id: "who_gho:gho:tfr", title: "Total fertility rate", meta: "" },
      { id: "who_gho:gho:WHS9_95", title: "Total fertility rate, 2000", meta: "" },
    ]]]);
    const rows = new Set(["owid:grapher:infant-mortality", "who_gho:gho:WHS9_95"]);
    const picked = pickSuggestions(companions, hits, rows, ["owid:grapher:life-expectancy"]);
    expect(picked.map((p) => p.hit.id)).toEqual(["owid:grapher:infant-mortality", "who_gho:gho:WHS9_95"]);
    // Nothing with rows: no suggestion, so the picker shows the note instead.
    expect(pickSuggestions(companions, hits, new Set(), [])).toEqual([]);
  });
  it("never includes a search-based concept in the live plan, and checks at most 2 hits for it", () => {
    const companions = suggestionsFor("Life expectancy");
    const hits = new Map<Companion, Hit[]>();
    for (const c of companions) if (!isExact(c)) hits.set(c, [
      { id: "x:y:1", title: c.label, meta: "" }, { id: "x:y:2", title: c.label, meta: "" }, { id: "x:y:3", title: c.label, meta: "" },
    ]);
    const check = checkIds(companions, hits, []);
    expect(check).toContain("owid:grapher:infant-mortality");
    expect(check).toContain("x:y:1");
    expect(check).not.toContain("x:y:3");
    expect(planLive(companions, new Set(), [])).toEqual(["who_gho:gho:MDG_0000000003"]);
  });
  it("runs no more than LIVE_BUDGET live fetches, skips ids that have rows and excluded ids", () => {
    const live = (id: string): Exact => ({ label: id, id, live: true, match: /^$/ });
    const companions: Companion[] = [live("a:b:1"), live("a:b:2"), live("a:b:3"), live("a:b:4"), live("a:b:5")];
    expect(LIVE_BUDGET).toBe(3);
    expect(planLive(companions, new Set(), [])).toEqual(["a:b:1", "a:b:2", "a:b:3"]);
    expect(planLive(companions, new Set(["a:b:1"]), [])).toEqual(["a:b:2", "a:b:3", "a:b:4"]);
    expect(planLive(companions, new Set(), ["a:b:1"])).toEqual(["a:b:2", "a:b:3", "a:b:4"]);
  });
});

describe("default compare countries", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));
  it("takes World plus the top shared countries when every series has World", () => {
    const main = m({ "region:WLD": 70, IND: 5, USA: 4, FRA: 3, DEU: 2 });
    const extra = m({ "region:WLD": 9, IND: 1, USA: 1, FRA: 1, DEU: 1, BRA: 9 });
    expect(defaultCompareGeos(new Map([["main", main], ["extra", extra]]), "main")).toEqual(["region:WLD", "IND", "USA", "FRA"]);
  });
  it("drops World when one series lacks it, and takes the top 4 of the intersection", () => {
    const main = m({ "region:WLD": 70, IND: 5, USA: 4, FRA: 3, DEU: 2, GBR: 1 });
    const extra = m({ IND: 1, USA: 1, FRA: 1, DEU: 1, BRA: 9 });
    expect(defaultCompareGeos(new Map([["main", main], ["extra", extra]]), "main")).toEqual(["IND", "USA", "FRA", "DEU"]);
  });
  it("breaks ties by geo code", () => {
    const main = m({ DEU: 2, BRA: 2, AUS: 2 });
    const extra = m({ DEU: 1, BRA: 1, AUS: 1 });
    expect(defaultCompareGeos(new Map([["main", main], ["extra", extra]]), "main")).toEqual(["AUS", "BRA", "DEU"]);
  });
  it("falls back to the series with the most countries when the intersection is empty", () => {
    const main = m({ IND: 5, USA: 4 });
    const extra = m({ BRA: 3, CHN: 2, FRA: 1 });
    expect(defaultCompareGeos(new Map([["main", main], ["extra", extra]]), "main")).toEqual(["BRA", "CHN", "FRA"]);
  });
  it("handles a single compared series like the intersection rule", () => {
    const main = m({ "region:WLD": 70, IND: 5, USA: 4, FRA: 3 });
    const extra = m({ IND: 1, USA: 1, FRA: 1, BRA: 2 });
    expect(defaultCompareGeos(new Map([["main", main], ["extra", extra]]), "main")).toEqual(["IND", "USA", "FRA"]);
  });
  it("returns nothing without series, and ignores non-country regions", () => {
    expect(defaultCompareGeos(new Map(), "main")).toEqual([]);
    expect(defaultCompareGeos(new Map([["main", m({ "region:EUR": 1, IND: 2 })]]), "main")).toEqual(["IND"]);
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
