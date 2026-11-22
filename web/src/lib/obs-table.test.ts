// Synthetic fixtures only.
import { describe, expect, it } from "vitest";
import { filterRows, sortRows, toJson } from "./obs-table";
import type { Citation } from "./format";

const rows = [["2020", "India", 5], ["2021", "indonesia", 12], ["2022", "Chile", null], ["2023", "Chad", 5], ["2024", "Peru", 40]];

describe("filterRows", () => {
  it("matches case-insensitively across cells", () => {
    expect(filterRows(rows, "IND").map((r) => r[1])).toEqual(["India", "indonesia"]);
    expect(filterRows(rows, "2022")).toHaveLength(1);
    expect(filterRows(rows, " ")).toHaveLength(5);
  });
});
describe("sortRows", () => {
  it("sorts numbers numerically, nulls last in both directions", () => {
    expect(sortRows(rows, 2, "asc").map((r) => r[2])).toEqual([5, 5, 12, 40, null]);
    expect(sortRows(rows, 2, "desc").map((r) => r[2])).toEqual([40, 12, 5, 5, null]);
  });
  it("sorts strings and keeps ties stable", () => {
    expect(sortRows(rows, 1, "asc").map((r) => r[1])).toEqual(["Chad", "Chile", "India", "indonesia", "Peru"]);
    expect(sortRows(rows, 2, "asc").filter((r) => r[2] === 5).map((r) => r[0])).toEqual(["2020", "2023"]);
    expect(sortRows(rows, 2, "desc").filter((r) => r[2] === 5).map((r) => r[0])).toEqual(["2020", "2023"]);
  });
  it("does not mutate input", () => { const c = [...rows]; sortRows(rows, 2, "desc"); expect(rows).toEqual(c); });
});
describe("toJson", () => {
  it("includes rows as objects, citations and licence", () => {
    const c: Citation = { source_id: "s", source_name: "Src", dataset_id: "d", licence_name: "CC-BY", licence_url: "https://x.test/l", redistribute: "yes", attribution: "a" };
    const j = JSON.parse(toJson(["t", "v"], [["2020", 1]], [c]));
    expect(j.rows).toEqual([{ t: "2020", v: 1 }]);
    expect(j.citations[0].source_name).toBe("Src");
    expect(j.licence[0]).toEqual({ name: "CC-BY", url: "https://x.test/l", redistribute: "yes" });
  });
  it("writes undefined, NaN and short rows as null", () => {
    const j = JSON.parse(toJson(["a", "b"], [[undefined, Number.NaN], [1]], []));
    expect(j.rows).toEqual([{ a: null, b: null }, { a: 1, b: null }]);
  });
});
