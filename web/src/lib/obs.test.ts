import { describe, expect, it } from "vitest";
import { buildChart } from "./obs";

const cols = ["period_start", "value", "geo", "dims", "freq", "unit", "unit_mult"];
describe("buildChart", () => {
  it("builds one line per geo on the dominant frequency", () => {
    const rows = [
      ["2020-01-01", 1, "IND", {}, "A", "%", 0],
      ["2021-01-01", 2, "IND", {}, "A", "%", 0],
      ["2020-01-01", 5, "VNM", {}, "A", "%", 0],
      ["2020-04-01", 9, "IND", {}, "Q", "%", 0],
      ["2020-01-01", null, "IND", {}, "A", "%", 0],
    ];
    const c = buildChart(cols, rows, (g) => ({ IND: "India", VNM: "Vietnam" })[g ?? ""] ?? g);
    expect(c.lines.map((l) => l.label)).toEqual(["India", "Vietnam"]);
    expect(c.freq).toBe("A");
    expect(c.rows).toEqual([{ t: "2020-01-01", India: 1, Vietnam: 5 }, { t: "2021-01-01", India: 2 }]);
    expect(c.unit).toBe("%");
  });
  it("splits lines by dimension when a geo has several", () => {
    const rows = [
      ["2020-01-01", 1, "IND", { SEX: "F" }, "A", "%", 0],
      ["2020-01-01", 2, "IND", { SEX: "M" }, "A", "%", 0],
    ];
    expect(buildChart(cols, rows, () => "India").lines.map((l) => l.label)).toEqual(["India (F)", "India (M)"]);
  });
  it("takes the unit per line, with its multiplier", () => {
    const rows = [
      ["2020-01-01", 1.2e6, "IND", { M: "count" }, "A", "persons", 0],
      ["2020-01-01", 5, "IND", { M: "rate" }, "A", "%", 0],
      ["2020-01-01", 3, "IND", { M: "amt" }, "A", "USD", 6],
    ];
    const c = buildChart(cols, rows, () => "India");
    expect(Object.fromEntries(c.lines.map((l) => [l.label, l.unit]))).toEqual({ "India (count)": "persons", "India (rate)": "%", "India (amt)": "USD, million" });
  });
});
