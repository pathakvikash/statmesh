import { describe, expect, it } from "vitest";
import {
  all, filterSources, filtersHref, first, isoDate, parseFilters, parseSourceFilters, sinceDate,
  searchHref, sourceFiltersHref, sourcesApiParams, toggleSource, toRaw, understandQuery, updatedPreset, without,
} from "./params";

describe("first / all", () => {
  it("first normalises string | string[] | undefined", () => {
    expect(first("a")).toBe("a");
    expect(first(["a", "b"])).toBe("a");
    expect(first([])).toBeUndefined();
    expect(first(undefined)).toBeUndefined();
  });
  it("all keeps repeatable values, de-duplicated, without blanks", () => {
    expect(all(["a", "b", "a", " "])).toEqual(["a", "b"]);
    expect(all("x")).toEqual(["x"]);
    expect(all(undefined)).toEqual([]);
  });
});

describe("filters <-> URL", () => {
  it("round-trips and drops invalid values", () => {
    const url = "q=gdp&source=imf&source=oecd&topic=Health&topic=Bogus&start_year=2015&end_year=20x&redistribute=maybe&updated_since=2026-10-01";
    const f = parseFilters(toRaw(new URLSearchParams(url)));
    expect(f).toMatchObject({ q: "gdp", source: ["imf", "oecd"], topic: ["Health"], start_year: "2015", end_year: undefined, redistribute: undefined, updated_since: "2026-10-01" });
    expect(parseFilters(toRaw(new URLSearchParams(filtersHref(f).split("?")[1])))).toEqual(f);
    expect(filtersHref(parseFilters({}))).toBe("/search");
  });
  it("without removes one value or a whole key", () => {
    const f = parseFilters({ source: ["imf", "oecd"], geo: "IND" });
    expect(without(f, "source", "imf").source).toEqual(["oecd"]);
    expect(without(f, "source").source).toEqual([]);
    expect(without(f, "geo").geo).toBeUndefined();
  });
  it("updated presets map to dates and back", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(sinceDate("30d", now)).toBe("2026-10-20");
    expect(updatedPreset("2026-10-20", now)).toBe("30d");
    expect(updatedPreset("2025-11-19", now)).toBe("1y");
    expect(updatedPreset("2020-01-01", now)).toBe("custom");
    expect(updatedPreset(undefined, now)).toBe("");
  });
  it("isoDate accepts real days only", () => {
    expect(isoDate("2026-02-28")).toBe("2026-02-28");
    expect(isoDate("2024-02-29")).toBe("2024-02-29");
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2025-02-29", "2026-1-01", "2026-01-01x"]) expect(isoDate(bad)).toBeUndefined();
  });
});

describe("understandQuery", () => {
  const geos = new Map([["IND", "India"], ["USA", "United States"], ["NER", "Niger"]]);
  it("drops filler words and detects a country by name", () => {
    expect(understandQuery("Unemployment rate in India since 2015", geos)).toEqual({ terms: ["unemployment", "rate", "2015"], geo: { code: "IND", name: "India" } });
  });
  it("matches whole words only", () => {
    expect(understandQuery("nigeria gdp", geos).geo).toBeUndefined();
    expect(understandQuery("exports to united states", geos).geo?.code).toBe("USA");
  });
});

describe("sources filters", () => {
  const mk = (id: string, o: object = {}) => ({ id, name: `${id} bank`, kind: "sdmx", auth: "none", key_configured: false, redistribute: "yes", series: 5, last_ingested_at: "2026-01-01", ...o });
  const rows = [mk("a"), mk("b", { kind: "file", auth: "free_key", series: 0, last_ingested_at: null }), mk("c", { auth: "free_key", key_configured: true, redistribute: "no", topics: ["Trade"] })];
  const ids = (q: string) => filterSources(rows, parseSourceFilters(toRaw(new URLSearchParams(q)))).map((s) => s.id);
  it("filters by each group; OR within, AND across", () => {
    expect(ids("")).toEqual(["a", "b", "c"]);
    expect(ids("q=BANK&kind=file")).toEqual(["b"]);
    expect(ids("access=keyless")).toEqual(["a"]);
    expect(ids("access=key_set&access=key_missing")).toEqual(["b", "c"]);
    expect(ids("status=catalogue")).toEqual(["b"]);
    expect(ids("redistribute=no&topic=Trade")).toEqual(["c"]);
    expect(ids("kind=ckan")).toEqual([]);
  });
  it("toggle round-trips through the URL", () => {
    const f = toggleSource(parseSourceFilters({}), "kind", "sdmx");
    expect(sourceFiltersHref(f)).toBe("/sources?kind=sdmx");
    expect(sourceFiltersHref(toggleSource(f, "kind", "sdmx"))).toBe("/sources");
  });
});

describe("sourcesApiParams", () => {
  it("passes what the API can express and leaves the rest to the local filter", () => {
    const f = parseSourceFilters(toRaw(new URLSearchParams("q=bank&kind=sdmx&topic=Trade&topic=Health&redistribute=yes&redistribute=no&access=keyless&status=data")));
    expect(sourcesApiParams(f)).toEqual({ q: "bank", kind: "sdmx", topic: ["Trade", "Health"], redistribute: undefined, auth: "keyless", status: "data" });
    expect(sourcesApiParams(parseSourceFilters({ access: ["key_set", "key_missing"] })).auth).toBe("key");
    expect(sourcesApiParams(parseSourceFilters({ access: ["keyless", "key_set"] })).auth).toBeUndefined();
  });
});

describe("search page links", () => {
  it("builds /search links and drops empty values", () => {
    expect(searchHref({ q: "gdp", source: undefined })).toBe("/search?q=gdp");
    expect(searchHref({ source: "imf" })).toBe("/search?source=imf");
    expect(searchHref({})).toBe("/search");
  });
  it("filtersHref targets /search and keeps every filter", () => {
    const f = parseFilters({ q: "gdp", source: ["a", "b"], topic: "Economy", geo: "IN", start_year: "2000" });
    const u = new URL(filtersHref(f), "http://x");
    expect(u.pathname).toBe("/search");
    expect(u.searchParams.getAll("source")).toEqual(["a", "b"]);
    expect(u.searchParams.get("q")).toBe("gdp");
    expect(u.searchParams.get("geo")).toBe("IN");
    expect(u.searchParams.get("start_year")).toBe("2000");
    expect(filtersHref(parseFilters({}))).toBe("/search");
  });
});
