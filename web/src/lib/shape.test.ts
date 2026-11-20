import { describe, expect, it } from "vitest";
import { chooseDims, chooseFreq, chooseView, dimLabel, dominant, dominantCombo, emptyReason, rowMatches, shapeFromAggregate, shapeFromRows, totalValue, valueLabel } from "./shape";

describe("chooseView", () => {
  it("no rows or no periods is empty", () => {
    expect(chooseView({ rows: 0, geos: 0, periods: { n: 0 } })).toBe("empty");
    expect(chooseView({ rows: 5, geos: 3, periods: { n: 0 } })).toBe("empty");
  });
  it("one geo, one period is a value", () => {
    expect(chooseView({ rows: 1, geos: 1, periods: { n: 1 } })).toBe("value");
  });
  it("one geo, two periods is a line (boundary)", () => {
    expect(chooseView({ rows: 2, geos: 1, periods: { n: 2 } })).toBe("line");
  });
  it("no geo recorded still counts as one geo", () => {
    expect(chooseView({ rows: 3, geos: 0, periods: { n: 3 } })).toBe("line");
  });
  it("many geos over one to three periods is ranked (both boundaries)", () => {
    expect(chooseView({ rows: 10, geos: 10, periods: { n: 1 } })).toBe("ranked");
    expect(chooseView({ rows: 30, geos: 10, periods: { n: 3 } })).toBe("ranked");
  });
  it("many geos over four or more periods is multi-line (boundary)", () => {
    expect(chooseView({ rows: 40, geos: 10, periods: { n: 4 } })).toBe("multi-line");
  });
  it("two geos, one period is ranked, not a value", () => {
    expect(chooseView({ rows: 2, geos: 2, periods: { n: 1 } })).toBe("ranked");
  });
});

describe("shapeFromRows", () => {
  it("counts periods, geos, freqs and dims from loaded rows", () => {
    const s = shapeFromRows([
      { geo: "IND", t: "2020", freq: "A", dims: { sex: "F", category: "rural" }, unit: "%" },
      { geo: "IND", t: "2021", freq: "A", dims: { sex: "F", category: "rural" }, unit: "%" },
      { geo: "IND", t: "2021", freq: "Q", dims: { sex: "M", category: "rural" }, unit: "%" },
      { geo: "USA", t: "2019", freq: "A", dims: { sex: "F", category: "rural" }, unit: null },
    ]);
    expect(s.rows).toBe(4);
    expect(s.geos).toBe(2);
    expect(s.periods).toEqual({ n: 3, first: "2019", last: "2021" });
    expect(s.freqs).toEqual(["A", "Q"]);
    expect(s.dims.sex).toEqual(["F", "M"]);
    expect(s.dims.category).toEqual(["rural"]);
    expect(s.units).toEqual(["%"]);
  });
  it("no rows gives an empty shape", () => {
    expect(shapeFromRows([])).toMatchObject({ rows: 0, geos: 0, periods: { n: 0, first: null, last: null } });
  });
});

describe("shapeFromAggregate", () => {
  it("maps the aggregate row and pairs dims keys with their value lists", () => {
    const s = shapeFromAggregate({ n_rows: 9, geos: 1, np: 4, first_t: "2020", last_t: "2023", freqs: ["A"], units: ["%"], dim_k: ["sex"], dim_vs: [["_T", "F"]] }, "remote");
    expect(s).toEqual({
      rows: 9, geos: 1, periods: { n: 4, first: "2020", last: "2023" }, freqs: ["A"], units: ["%"],
      dims: { sex: ["_T", "F"] }, status: "remote",
    });
  });
  it("null aggregates and unknown status degrade to empty and unknown", () => {
    const s = shapeFromAggregate({ n_rows: 0, geos: 0, np: 0, first_t: null, freqs: null, dim_k: null, dim_vs: null }, "weird");
    expect(s).toMatchObject({ rows: 0, periods: { n: 0, first: null }, freqs: [], dims: {}, status: "unknown" });
  });
});

describe("dimension selection", () => {
  const dims = { sex: ["F", "M", "_T"], category: ["urban", "rural"], unit: ["only"] };
  it("only multi-valued dims are chosen", () => {
    expect(Object.keys(chooseDims({}, dims))).toEqual(["sex", "category"]);
  });
  it("URL value wins when it exists, unknown values are ignored", () => {
    expect(chooseDims({ "dim.sex": "M" }, dims).sex).toBe("M");
    expect(chooseDims({ "dim.sex": "X" }, dims).sex).toBe("_T");
  });
  it("defaults to the all-categories value, then the dominant combo, then the first value", () => {
    expect(chooseDims({}, dims)).toEqual({ sex: "_T", category: "urban" });
    expect(chooseDims({}, { sex: ["F", "M"] }, { sex: "M" })).toEqual({ sex: "M" });
  });
  it("totalValue finds the usual total codes", () => {
    expect(totalValue(["F", "Total"])).toBe("Total");
    expect(totalValue(["F", "M"])).toBeUndefined();
  });
  it("labels: dimension names read as words, all-categories codes get words", () => {
    expect(dimLabel("age_group")).toBe("Age group");
    expect(dimLabel("sex")).toBe("Sex");
    expect(valueLabel("_T")).toBe("Total");
    expect(valueLabel("ALL")).toBe("All");
    expect(valueLabel("rural")).toBe("rural");
  });
  it("rowMatches treats a missing dim as empty", () => {
    expect(rowMatches({ sex: "F" }, { sex: "F" })).toBe(true);
    expect(rowMatches({}, { sex: "" })).toBe(true);
    expect(rowMatches({ sex: "M" }, { sex: "F" })).toBe(false);
  });
  it("dominantCombo picks the most populated combination", () => {
    const rows = [{ dims: { sex: "F", c: "a" } }, { dims: { sex: "M", c: "a" } }, { dims: { sex: "M", c: "b" } }, { dims: { sex: "M", c: "b" } }];
    expect(dominantCombo(rows, ["sex", "c"])).toEqual({ sex: "M", c: "b" });
    expect(dominantCombo([], ["sex"])).toEqual({});
  });
});

describe("frequency and helpers", () => {
  it("chooseFreq honours a known asked freq and otherwise takes the most populated", () => {
    expect(chooseFreq("Q", ["A", "Q"])).toBe("Q");
    expect(chooseFreq("W", ["A", "Q"])).toBe("A");
    expect(chooseFreq(undefined, [])).toBeUndefined();
  });
  it("dominant handles ties by first seen and empty input", () => {
    expect(dominant(["x", "y", "y", "x"])).toBe("x");
    expect(dominant<string>([])).toBeUndefined();
  });
});

describe("emptyReason", () => {
  const base = { dataset: "ingested" as const, source: "who_gho", datasetId: "gho", error: false };
  it("rate limit shows the retry seconds", () => {
    expect(emptyReason({ ...base, obs: { status: "rate_limited", retry_after: 12.2 } }).detail).toBe("Retry in about 13 s.");
  });
  it("forbidden and not_found show the API warning", () => {
    expect(emptyReason({ ...base, obs: { status: "forbidden", warning: "Licence" } }).detail).toBe("Licence");
    expect(emptyReason({ ...base, obs: { status: "not_found" } }).title).toBe("No data found for this series");
  });
  it("an error is reported as such", () => {
    expect(emptyReason({ ...base, error: true }).title).toBe("Observations could not be loaded");
  });
  it("a remote dataset without rows is not loaded, with the ingest command", () => {
    const r = emptyReason({ ...base, dataset: "remote", obs: { status: "ok" } });
    expect(r.title).toBe("Not loaded yet");
    expect(r.command).toBe("statmesh ingest who_gho --dataset gho");
  });
  it("a loaded dataset with no values says so and has no command", () => {
    const r = emptyReason({ ...base, obs: { status: "ok" } });
    expect(r.command).toBeUndefined();
    expect(r.title).toContain("loaded");
  });
});
