import { describe, expect, it } from "vitest";
import { autoChart } from "./auto-chart";
import { groupSeries } from "./chart";
import { csvOf } from "@/components/chat-viz/chart-card";
import type { ChatEvent } from "./events";

const cols = ["period_start", "value", "geo", "freq", "unit"];
const obs = (id: string, rows: unknown[][], extra = {}): ChatEvent => ({ t: "result", id: "r" + id, name: "get_observations", output: { series_id: id, status: "ok", columns: cols, rows, citations: [], ...extra } });
const yrs = (geo: string, vals: number[], unit = "%") => vals.map((v, i) => [`${2020 + i}-01-01`, v, geo, "A", unit]);

describe("autoChart", () => {
  it("charts a time series of 3+ periods, titled from search hits", () => {
    const ev: ChatEvent[] = [
      { t: "result", id: "s", name: "search_series", output: { hits: [{ series_id: "a", title: "Inflation" }] } },
      obs("a", yrs("IND", [1, 2, 3])),
    ];
    const c = autoChart(ev)!;
    expect(c.series).toHaveLength(1);
    expect(c.series[0]).toMatchObject({ series_id: "a", label: "Inflation", unit: "%" });
  });
  it("one line per country for a comparison", () => {
    const c = autoChart([obs("a", [...yrs("IND", [1, 2, 3]), ...yrs("USA", [4, 5, 6])])])!;
    expect(c.series.map((s) => s.label)).toEqual(["a: IND", "a: USA"]);
  });
  it("skips single values, short series and text-only answers", () => {
    expect(autoChart([obs("a", yrs("IND", [1]))])).toBeNull();
    expect(autoChart([obs("a", yrs("IND", [1, 2]))])).toBeNull();
    expect(autoChart([{ t: "text", text: "hi" }])).toBeNull();
    expect(autoChart([obs("a", yrs("IND", [1, 2, 3]), { status: "rate_limited" })])).toBeNull();
  });
  it("defers to a chart the model asked for", () => {
    const ev: ChatEvent[] = [{ t: "call", id: "c", name: "show_chart", input: {} }, obs("a", yrs("IND", [1, 2, 3]))];
    expect(autoChart(ev)).toBeNull();
  });
  it("uses only numbers from the results and caps series", () => {
    const c = autoChart(Array.from({ length: 10 }, (_, i) => obs("s" + i, yrs("IND", [7, 8, 9]))))!;
    expect(c.series).toHaveLength(8);
    expect(c.series.every((s) => s.points.map((p) => p.value).join() === "7,8,9")).toBe(true);
  });
  // MCP _compact output: constant columns live in `constants`, rows are [geo, period_start, value].
  const compact = (id: string, vals: number[], constants: Record<string, unknown>, geo = "IND"): ChatEvent => ({
    t: "result", id: "c" + id + geo, name: "get_observations",
    output: { series_id: id, status: "ok", columns: ["geo", "period_start", "value"], constants, rows: vals.map((v, i) => [geo, `${2020 + i}-01-01`, v]), citations: [] },
  });
  it("restores units from MCP constants and keeps different units apart", () => {
    const c = autoChart([compact("u", [5, 6, 7], { unit: "%", freq: "A" }), compact("d", [80, 85, 90], { unit: "% of GDP", freq: "A" })])!;
    expect(c.series.map((s) => s.unit)).toEqual(["%", "% of GDP"]);
    expect(groupSeries(c.series)).toHaveLength(2);
  });
  it("sets the chart-level unit for a single-unit chart", () => {
    expect(autoChart([compact("u", [5, 6, 7], { unit: "%", freq: "A" })])!.unit).toBe("%");
  });
  it("keeps the same series for different geos, without duplicate points for identical calls", () => {
    const k = { unit: "%", freq: "A" };
    const c = autoChart([compact("x", [1, 2, 3], k, "IND"), compact("x", [4, 5, 6], k, "USA"), compact("x", [1, 2, 3], k, "IND")])!;
    expect(c.series).toHaveLength(2);
    expect(new Set(c.series.map((s) => s.series_id)).size).toBe(2);
    expect(c.series.every((s) => s.points.length === 3)).toBe(true);
  });
  it("puts unknown-unit series in their own panels and never mixes frequencies", () => {
    const mk = (id: string, unit: string | undefined, freq: string) => ({ series_id: id, label: id, unit, freq, points: [{ period: "2020-01-01", value: 1 }] });
    expect(groupSeries([mk("a", undefined, "A"), mk("b", undefined, "A")])).toHaveLength(2);
    expect(groupSeries([mk("a", "%", "A"), mk("b", "%", "M")])).toHaveLength(2);
    expect(groupSeries([mk("a", "%", "A"), mk("b", "Percent", "A"), mk("c", "PT", "A"), mk("d", "per cent", "A")])).toHaveLength(1);
  });
  it("puts the unit in CSV headers", () => {
    const c = autoChart([compact("u", [5, 6, 7], { unit: "%", freq: "A" })])!;
    expect(csvOf(c).split("\n")[0]).toBe('period,"u (%)"');
  });
});
