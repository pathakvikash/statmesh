import { describe, expect, it } from "vitest";
import { executeShowChart, MAX_POINTS, showChartInput, summarizeChart, type ObsFetcher } from "./chart";
import { mergeRows } from "./merge";

const cols = ["period_start", "value", "unit"];
const cit = { source_id: "s", source_name: "S", dataset_id: "d", series_id: "a", licence_name: "L", licence_url: "u", redistribute: "yes" as const, attribution: "x" };
const base = { title: "T", type: "line" as const, series: [{ series_id: "a" }] };

describe("showChartInput", () => {
  it("accepts a valid input and rejects bad ones", () => {
    expect(showChartInput.safeParse({ ...base, start: "2015-01-01" }).success).toBe(true);
    expect(showChartInput.safeParse({ ...base, type: "pie" }).success).toBe(false);
    expect(showChartInput.safeParse({ ...base, series: [] }).success).toBe(false);
    expect(showChartInput.safeParse({ ...base, series: Array(9).fill({ series_id: "a" }) }).success).toBe(false);
    expect(showChartInput.safeParse({ ...base, end: "2020" }).success).toBe(false);
  });
});

describe("executeShowChart", () => {
  const fetchObs: ObsFetcher = async (id) => {
    if (id === "bad") return { status: "not_found", columns: [], rows: [] };
    if (id === "boom") throw new Error("net down");
    const n = id === "big" ? MAX_POINTS + 5 : 2;
    const rows = Array.from({ length: n }, (_, i) => [`2020-${String(i).padStart(5, "0")}`, i, "%"]);
    return { status: "ok", columns: cols, rows: [...rows, ["x", null, "%"]], citations: [cit, cit] };
  };
  it("maps points, units and dedups citations", async () => {
    const r = await executeShowChart({ ...base, series: [{ series_id: "a", label: "A" }] }, fetchObs);
    expect(r.series[0]).toEqual({ series_id: "a", label: "A", points: [{ period: "2020-00000", value: 0 }, { period: "2020-00001", value: 1 }] });
    expect(r.unit).toBe("%");
    expect(r.citations).toHaveLength(1);
  });
  it("caps points per series", async () => {
    const r = await executeShowChart({ ...base, series: [{ series_id: "big" }] }, fetchObs);
    expect(r.series[0].points).toHaveLength(MAX_POINTS);
    expect(r.warnings[0]).toMatch(/latest 2000/);
  });
  it("warns per failing series and keeps the rest", async () => {
    const r = await executeShowChart({ ...base, series: [{ series_id: "a" }, { series_id: "bad" }, { series_id: "boom" }] }, fetchObs);
    expect(r.series.map((s) => s.series_id)).toEqual(["a"]);
    expect(r.warnings).toEqual(["bad: not_found", "boom: net down"]);
  });
});

describe("executeShowChart dims, dedupe, signal", () => {
  const dcols = ["period_start", "value", "freq", "dims", "unit"];
  const A = { sex: "F" }, B = { sex: "M" };
  const calls: string[] = [];
  let sig: AbortSignal | undefined;
  const fetchObs: ObsFetcher = async (id, o) => {
    calls.push(id);
    sig = o.signal;
    return {
      status: "ok", columns: dcols,
      rows: [
        ["2020-01-01", 1, "A", A, "%"], ["2021-01-01", 2, "A", A, "%"], ["2022-01-01", 3, "A", A, "%"],
        ["2020-01-01", 9, "A", B, "%"], ["2021-01-01", 8, "A", B, "%"],
        ["2020-03-01", 5, "Q", A, "%"],
      ],
    };
  };
  it("keeps the dominant freq and the dims line with most points, and says which", async () => {
    const r = await executeShowChart({ ...base, series: [{ series_id: "a" }] }, fetchObs);
    expect(r.series[0].points.map((p) => p.value)).toEqual([1, 2, 3]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/dimension combinations.*F/);
  });
  it("fetches a repeated series_id once and forwards the abort signal", async () => {
    calls.length = 0;
    const ac = new AbortController();
    const r = await executeShowChart({ ...base, series: [{ series_id: "a", label: "First" }, { series_id: "a", label: "Second" }] }, fetchObs, ac.signal);
    expect(calls).toEqual(["a"]);
    expect(r.series).toHaveLength(1);
    expect(r.series[0].label).toBe("First");
    expect(sig).toBe(ac.signal);
  });
});

describe("summarizeChart", () => {
  it("keeps ids, counts, ends and warnings but no point list", () => {
    const s = summarizeChart({
      title: "T", type: "line", unit: "%", citations: [], warnings: ["w"],
      series: [{ series_id: "a", label: "A", points: [{ period: "2020-01-01", value: 1.5 }, { period: "2021-01-01", value: 2.5 }, { period: "2022-01-01", value: 3.5 }] }],
    });
    expect(s.series[0]).toEqual({ series_id: "a", label: "A", points: 3, first_period: "2020-01-01", first_value: 1.5, last_period: "2022-01-01", last_value: 3.5 });
    expect(s.warnings).toEqual(["w"]);
    expect(JSON.stringify(s)).not.toContain("2.5");
  });
});

describe("mergeRows", () => {
  it("aligns on period, sorts, and leaves gaps", () => {
    const rows = mergeRows([
      { series_id: "a", label: "A", points: [{ period: "2021-01-01", value: 2 }, { period: "2020-01-01", value: 1 }] },
      { series_id: "b", label: "B", points: [{ period: "2021-01-01", value: 9 }, { period: "2020-06-01", value: 5 }] },
    ]);
    expect(rows).toEqual([
      { period: "2020-01-01", a: 1 },
      { period: "2020-06-01", b: 5 },
      { period: "2021-01-01", a: 2, b: 9 },
    ]);
  });
});
