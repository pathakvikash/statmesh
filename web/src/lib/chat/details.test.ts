import { describe, expect, it } from "vitest";
import { attributionLine, displayCells, pageSlice, tabulate } from "./details";
import { leanForModel, restoreFull, trimForModel } from "./trim";

describe("pageSlice", () => {
  it("windows 5 rows and clamps", () => {
    expect(pageSlice(12, 0)).toMatchObject({ from: 1, to: 5, pages: 3, start: 0 });
    expect(pageSlice(12, 2)).toMatchObject({ from: 11, to: 12, start: 10 });
    expect(pageSlice(12, 99).page).toBe(2);
    expect(pageSlice(12, -3).page).toBe(0);
    expect(pageSlice(0, 0)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
});

describe("displayCells", () => {
  const columns = ["series_id", "source_id", "geo", "period", "value", "unit", "unit_mult", "dataset_id", "note"];
  const rows = [["a:b:c", "a", "IND", "2020", 1234.5678, "%", null, "d", null], ["a:b:c", "a", "IND", "2021", null, "%", null, "d", "n/a"]];
  it("hides ids, empty columns and folds the unit into the value", () => {
    const c = displayCells(columns, rows, false);
    expect(c.headers).toEqual(["geo", "period", "value"]);
    expect(c.rows[0]).toEqual(["IND", "2020", "1,234.5678 %"]);
    expect(c.rows[1][2]).toBe("");
    expect(c.hidden).toBe(6);
  });
  it("shows everything on request, and never nothing", () => {
    expect(displayCells(columns, rows, true).headers).toEqual(columns);
    expect(displayCells(["series_id"], [["x"]], false).headers).toEqual(["series_id"]);
  });
});

describe("tabulate", () => {
  it("handles row results, search hits and describe_series; null otherwise", () => {
    expect(tabulate({ columns: ["a"], rows: [[1]] })).toEqual({ columns: ["a"], rows: [[1]] });
    expect(tabulate({ hits: [{ series_id: "s", title: "T", geo: "IND" }] })?.rows[0].slice(0, 3)).toEqual(["s", "T", "IND"]);
    expect(tabulate({ series_id: "s", title: "T", unit: null, dims: { a: ["b"] } })?.rows).toEqual([["series_id", "s"], ["title", "T"]]);
    expect(tabulate({ status: "ok" })).toBeNull();
    expect(tabulate("text")).toBeNull();
  });
});

it("attributionLine dedupes and falls back to the source name", () => {
  expect(attributionLine([{ attribution: "Source: WHO." }, { attribution: "Source: WHO" }, { source_name: "BEA" }])).toBe("Source: WHO; BEA");
});

describe("trimForModel", () => {
  const COLS = ["series_id", "source_id", "geo", "period_start", "period_end", "value", "unit", "unit_mult"];
  const row = (geo: string, y: number, v: number) => ["s", "wb", geo, `${y}-01-01`, `${y}-12-31`, v, "Persons", 3];
  const series = (geo: string, n: number) => Array.from({ length: n }, (_, i) => row(geo, 2000 + i, i));
  type T = { columns: string[]; rows: unknown[][]; omitted_rows?: number; note?: string };

  it("drops id columns but keeps unit and unit_mult, so 5234 x 10^3 is still readable as 5.2 million", () => {
    const t = trimForModel({ columns: COLS, rows: [row("IND", 2020, 5234)] }) as T;
    expect(t.columns).toEqual(["geo", "period_start", "period_end", "value", "unit", "unit_mult"]);
    expect(t.rows[0].slice(3)).toEqual([5234, "Persons", 3]);
  });
  it("keeps the latest rows of a single geo with real column names, and says what was omitted", () => {
    const t = trimForModel({ columns: COLS, rows: series("IND", 100) }) as T;
    expect(t.rows).toHaveLength(60);
    expect(t.rows[59][1]).toBe("2099-01-01");
    expect(t.rows[0][1]).toBe("2040-01-01");
    expect(t.omitted_rows).toBe(40);
    expect(t.note).toMatch(/older rows omitted per geo \(40 omitted/i);
  });
  it("gives every geo its own latest rows instead of starving the first ones", () => {
    const t = trimForModel({ columns: COLS, rows: [...series("AAA", 50), ...series("ZZZ", 50)] }) as T;
    const by = (g: string) => t.rows.filter((r) => r[0] === g);
    expect(by("AAA")).toHaveLength(30);
    expect(by("ZZZ")).toHaveLength(30);
    expect(by("AAA")[29][1]).toBe("2049-01-01"); // latest of AAA, not cut
    expect(t.rows.map((r) => r[0]).join("")).toMatch(/^A+Z+$/); // original order kept
  });
  it("leaves small results and other shapes alone", () => {
    const small = { columns: ["period_start"], rows: [["2020"]] };
    expect(trimForModel(small)).toBe(small);
    const other = { hits: [] };
    expect(trimForModel(other)).toBe(other);
  });
});

describe("leanForModel / restoreFull", () => {
  const full = { columns: ["series_id", "period_start", "value"], rows: Array.from({ length: 80 }, (_, i) => ["s", `${2000 + i}`, i]) };
  const mcp = { content: [{ type: "text", text: JSON.stringify(full) }] }; // what the MCP client's execute returns
  const tools = { get_observations: { execute: async () => mcp }, other: { execute: async () => 1 } };

  it("normal path: the model output is trimmed, the tool's own result stays full", async () => {
    const lean = leanForModel(tools, false, new Map()) as unknown as { get_observations: { execute: () => Promise<unknown>; toModelOutput: (a: { output: unknown }) => { value: { rows: unknown[]; omitted_rows: number } } } };
    expect(await lean.get_observations.execute()).toBe(mcp);
    const m = lean.get_observations.toModelOutput({ output: mcp });
    expect(m.value.rows).toHaveLength(60);
    expect(m.value.omitted_rows).toBe(20);
  });
  it("CLI path: execute returns the trimmed copy plus a fullRef that restores the full result", async () => {
    const fulls = new Map<string, unknown>();
    const lean = leanForModel(tools, true, fulls) as unknown as { get_observations: { execute: () => Promise<{ rows: unknown[]; fullRef: string }> } };
    const out = await lean.get_observations.execute();
    expect(out.rows).toHaveLength(60);
    expect(restoreFull(out, fulls)).toEqual(full);
    expect(restoreFull({ rows: [] }, fulls)).toEqual({ rows: [] });
  });
  it("leaves tools without get_observations alone", () => {
    const t = { other: tools.other };
    expect(leanForModel(t, true, new Map())).toBe(t);
  });
});
