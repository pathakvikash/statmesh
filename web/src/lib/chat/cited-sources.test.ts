import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./events";
import { collectSourceGroups, pillSummary, sourceColor, truncate } from "./cited-sources";

const call = (id: string, name: string, input: unknown): ChatEvent => ({ t: "call", id, name, input });
const res = (id: string, name: string, output: unknown): ChatEvent => ({ t: "result", id, name, output });

const events: ChatEvent[] = [
  call("1", "search_series", { q: "suicide" }),
  res("1", "search_series", { hits: [
    { series_id: "who_gho:gho:SUI", title: "Crude suicide rates", source_id: "who_gho" },
    { series_id: "wb:wdi:POP", title: "Population", source_id: "wb" },
    { series_id: "bea:x:UNUSED", title: "Never used", source_id: "bea" },
  ] }),
  call("2", "get_observations", { series_id: "who_gho:gho:SUI" }),
  res("2", "get_observations", { status: "ok", rows: [[1]], citations: [{ source_id: "who_gho", source_name: "WHO Global Health Observatory", series_id: "who_gho:gho:SUI" }] }),
  call("3", "show_chart", { series: [{ series_id: "wb:wdi:POP" }, { series_id: "who_gho:gho:SUI" }] }),
  call("4", "describe_series", { series_id: "other:d:Z" }),
];

describe("collectSourceGroups", () => {
  const g = collectSourceGroups(events);
  it("groups used series by source, deduped, in first-seen order, without unused hits", () => {
    expect(g.map((x) => x.id)).toEqual(["who_gho", "wb", "other"]);
    expect(g[0].series).toEqual([{ id: "who_gho:gho:SUI", title: "Crude suicide rates" }]);
    expect(g.flatMap((x) => x.series.map((s) => s.id))).not.toContain("bea:x:UNUSED");
  });
  it("names a source from its citation, else its id", () => {
    expect(g[0]).toMatchObject({ name: "WHO Global Health Observatory", code: "WGH" });
    expect(g[2].name).toBe("other"); // from the id prefix: no result named it
  });
  it("summarises for the pill: 3 icons, first name, other sources", () => {
    const s = pillSummary(g);
    expect(s.icons).toHaveLength(3);
    expect(s.first).toBe("WHO Global Health Observatory");
    expect(s.more).toBe(2);
    expect(s.seriesCount).toBe(3);
    expect(pillSummary([])).toMatchObject({ first: "", more: 0, seriesCount: 0 });
  });
});

it("colours deterministically", () => {
  expect(sourceColor("wb")).toBe(sourceColor("wb"));
  expect(sourceColor("wb")).not.toBe(sourceColor("bea"));
  expect(sourceColor("wb")).toMatch(/^hsl\(\d+ 45% 36%\)$/);
});

it("truncates with an ellipsis", () => {
  expect(truncate("short", 10)).toBe("short");
  expect(truncate("WHO Global Health Observatory", 12)).toBe("WHO Global…");
});
