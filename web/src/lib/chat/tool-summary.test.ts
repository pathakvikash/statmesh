import { describe, expect, it } from "vitest";
import { summarizeArgs, summarizeTool } from "./tool-summary";

const obs = (o: Record<string, unknown>) => ({ series_id: "X", status: "ok", columns: [], rows: [], truncated: false, partial: false, citations: [], ...o });

describe("summarizeArgs", () => {
  it("shows key arguments, quoting free text", () => {
    expect(summarizeArgs("search_series", { q: "robotics", geo: "IND", source: "datacommons" })).toBe(
      'q="robotics", geo=IND, source=datacommons',
    );
  });
  it("collapses long input and stays within the cap", () => {
    const s = summarizeArgs("run_sql", { sql: "select " + "x, ".repeat(100) });
    expect(s.length).toBeLessThanOrEqual(120);
    expect(s.endsWith("…")).toBe(true);
  });
  it("uses the first keys for an unknown tool", () => {
    expect(summarizeArgs("mystery", { a: 1, b: "two", c: true, d: 4 })).toBe("a=1, b=two, c=true");
    expect(summarizeArgs("mystery", { b: "two words" })).toBe("b=\"two words\"");
  });
});

describe("summarizeTool", () => {
  it("is running while pending and failed when the turn ended without a result", () => {
    expect(summarizeTool("run_sql", { sql: "select 1" }, undefined, true).status).toBe("running");
    const done = summarizeTool("run_sql", { sql: "select 1" }, undefined, false);
    expect(done.status).toBe("failed");
    expect(done.outcome).toMatch(/no result/);
  });

  it("search_series with hits and with none", () => {
    const hit = summarizeTool("search_series", { q: "robotics" }, { query: "robotics", hits: [{ series_id: "a" }, { series_id: "b" }], next_offset: null }, false);
    expect(hit).toMatchObject({ status: "ok", outcome: "2 results" });
    const none = summarizeTool("search_series", { q: "robotics" }, { query: "robotics", hits: [] }, false);
    expect(none).toMatchObject({ status: "no_data", outcome: "0 results" });
  });

  it("get_observations ok, not_found, rate_limited, forbidden, truncated and partial", () => {
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ rows: [[1], [2]] }), false))
      .toMatchObject({ status: "ok", outcome: "2 rows" });
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ rows: [] }), false))
      .toMatchObject({ status: "no_data", outcome: "0 rows" });
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ status: "not_found" }), false))
      .toMatchObject({ status: "failed", outcome: "not found" });
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ status: "forbidden" }), false))
      .toMatchObject({ status: "failed", outcome: "forbidden" });
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ status: "rate_limited", retry_after: 59.2 }), false))
      .toMatchObject({ status: "failed", outcome: "rate limited, retry in 60 s" });
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ status: "rate_limited" }), false).outcome)
      .toBe("rate limited, try again later");
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ rows: [[1]], truncated: true }), false))
      .toMatchObject({ status: "ok", outcome: "1 rows, truncated" });
    expect(summarizeTool("get_observations", { series_id: "s" }, obs({ rows: [[1]], partial: true }), false))
      .toMatchObject({ status: "ok", outcome: "1 rows, partial result" });
  });

  it("run_sql rows and truncation", () => {
    expect(summarizeTool("run_sql", { sql: "select 1" }, { sql: "select 1", columns: ["a"], rows: [[1]], truncated: false, citations: [] }, false))
      .toMatchObject({ status: "ok", outcome: "1 rows" });
    expect(summarizeTool("run_sql", { sql: "select 1" }, { sql: "select 1", columns: ["a"], rows: [], truncated: true, citations: [] }, false))
      .toMatchObject({ status: "no_data", outcome: "0 rows" });
  });

  it("show_chart with data, with no points, unavailable and failed", () => {
    const input = { title: "CPI", series: [{ series_id: "a" }] };
    expect(summarizeTool("show_chart", input, { series: [{ points: [{}, {}] }] }, false))
      .toMatchObject({ status: "ok", outcome: "chart: 1 series, 2 points" });
    expect(summarizeTool("show_chart", input, { series: [{ points: [] }] }, false))
      .toMatchObject({ status: "no_data" });
    expect(summarizeTool("show_chart", input, { unavailable: true }, false).status).toBe("failed");
    expect(summarizeTool("show_chart", input, { foo: 1 }, false))
      .toMatchObject({ status: "failed", outcome: "could not build the chart" });
    expect(summarizeTool("show_chart", input, undefined, true).status).toBe("running");
  });

  it("an error object is failed with its message, whatever the tool", () => {
    expect(summarizeTool("search_series", { q: "x" }, { error: "Index is down" }, false))
      .toMatchObject({ status: "failed", outcome: "Index is down" });
    expect(summarizeTool("show_chart", {}, { error: "" }, false))
      .toMatchObject({ status: "failed", outcome: "The tool failed." });
  });

  it("an unknown tool with a result is ok, and with an error object is failed", () => {
    expect(summarizeTool("list_sources", { q: "x" }, [{ id: "a" }], false)).toMatchObject({ status: "ok", outcome: "done" });
    expect(summarizeTool("list_sources", {}, { error: "nope" }, false)).toMatchObject({ status: "failed", outcome: "nope" });
  });
});
