import { describe, expect, it } from "vitest";
import { askAbout } from "./ask-about";

describe("askAbout keeps the rule-7 instruction under the cap", () => {
  it("series: max-length title, question, id and source", () => {
    const x = "x".repeat(1000);
    const q = askAbout({ kind: "series", id: x, title: x, source: x }, x);
    expect(q.length).toBeLessThanOrEqual(500);
    expect(q).toContain("Use describe_series and get_observations for every number and cite the series id.");
  });
  it("source: max-length name, id and question", () => {
    const x = "x".repeat(1000);
    const q = askAbout({ kind: "source", id: x, name: x }, x);
    expect(q.length).toBeLessThanOrEqual(500);
    expect(q).toContain("Use list_sources, search_series (source filter) and run_sql for every number.");
  });
});
