import { describe, expect, it } from "vitest";
import { collectEvidence } from "./evidence";

const cit = { source_id: "s", source_name: "S", dataset_id: "d", series_id: "s:d/IND", licence_name: "L", licence_url: "u", redistribute: "yes", attribution: "a" };

describe("collectEvidence", () => {
  it("gathers series ids, sql, meta and deduped citations from tool events only", () => {
    const ev = collectEvidence([
      { t: "text", text: "made-up:id/XXX" },
      { t: "call", id: "1", name: "run_sql", input: { sql: "SELECT 1" } },
      { t: "result", id: "1", name: "run_sql", output: { sql: "SELECT 1", rows: [], citations: [cit, cit] } },
      { t: "result", id: "2", name: "search_series", output: { hits: [{ series_id: "s:d/IND", title: "Unemp", unit: "%", start: "2015", end: "2024" }] } },
    ]);
    expect(ev.sqls).toEqual(["SELECT 1"]);
    expect(ev.seriesIds).toEqual(["s:d/IND"]);
    expect(ev.citations).toHaveLength(1);
    expect(ev.meta.get("s:d/IND")?.unit).toBe("%");
    expect(ev.results).toHaveLength(2);
  });
});
