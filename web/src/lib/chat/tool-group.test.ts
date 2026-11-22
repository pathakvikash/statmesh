import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./events";
import { groupLabel, groupToolCalls, shortCode, visibleSources } from "./tool-group";

const call = (id: string, name: string, input: unknown = {}): ChatEvent => ({ t: "call", id, name, input });
const res = (id: string, name: string, output: unknown): ChatEvent => ({ t: "result", id, name, output });
const hit = (series_id: string, source_id: string, title = "T") => ({ series_id, source_id, title });
const cit = (source_id: string, source_name: string) => ({ source_id, source_name, dataset_id: "d" });

describe("shortCode", () => {
  it("uses initials for names and the short id otherwise", () => {
    expect(shortCode("World Bank")).toBe("WB");
    expect(shortCode("bea")).toBe("BEA");
    expect(shortCode("mospi")).toBe("MOSPI");
    expect(shortCode("datacommons")).toBe("DAT");
    expect(shortCode("open_canada")).toBe("OC");
  });
});

describe("groupToolCalls", () => {
  const ev: ChatEvent[] = [
    call("1", "search_series", { q: "a" }),
    res("1", "search_series", { error: "MCP error -32602: Input validation error" }),
    call("2", "search_series", { q: "a" }),
    res("2", "search_series", { hits: [hit("wb:x:1", "worldbank", "GDP"), hit("bea:y:2", "bea", "Unused")], next_offset: null }),
    call("3", "get_observations", { series_id: "wb:x:1" }),
    res("3", "get_observations", { status: "ok", rows: [[1]], citations: [cit("worldbank", "World Bank")] }),
    call("4", "show_chart", { series: [{ series_id: "wb:x:1" }] }),
    res("4", "show_chart", { series: [] }),
  ];
  it("counts calls except charts, mutes a failure that was retried, dedupes used sources", () => {
    const g = groupToolCalls(ev, false);
    expect(g.total).toBe(3);
    expect(g.failed).toBe(0);
    expect(g.calls[0].muted).toBe(true);
    expect(g.sources.map((s) => s.id)).toEqual(["worldbank"]); // bea was found but never used
    expect(g.sources[0]).toMatchObject({ name: "World Bank", code: "WB", titles: ["GDP"] });
    expect(groupLabel(g)).toBe("Searched 3 times · 1 source");
  });
  it("keeps an unrecovered failure in the count", () => {
    const g = groupToolCalls([call("1", "describe_series", { series_id: "a" }), res("1", "describe_series", { error: "boom" })], false);
    expect(g.failed).toBe(1);
    expect(g.calls[0].muted).toBe(false);
  });
  it("shows Searching while a call has no result yet", () => {
    const g = groupToolCalls([call("1", "search_series", { q: "a" })], true);
    expect(g.running).toBe(1);
    expect(groupLabel(g)).toBe("Searching…");
  });
  it("caps the chips and counts the rest", () => {
    const v = visibleSources(Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `s${i}`, code: "S", titles: [] })));
    expect(v.shown).toHaveLength(5);
    expect(v.more).toBe(2);
  });
});
