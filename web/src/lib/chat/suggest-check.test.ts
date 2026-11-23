import { describe, expect, it } from "vitest";
import { annotateHits, NO_DATA_NOTE, sqlDataLayer, withHasData } from "./suggest-check";

const hits = [{ series_id: "a:b:c", title: "x" }, { series_id: "d:e", title: "y" }];
const layer = (have: string[]) => async () => new Set(have);
type R = { hits: { has_data: unknown }[]; no_data_note?: string };

describe("annotateHits", () => {
  it("marks hits with and without data", async () => {
    const r = (await annotateHits({ hits, next_offset: null }, layer(["d:e"]))) as R;
    expect(r.hits.map((h) => h.has_data)).toEqual([false, true]);
    expect(r.no_data_note).toBeUndefined();
  });
  it("adds no_data_note when all are false", async () => {
    const r = (await annotateHits({ hits }, layer([]))) as R;
    expect(r.no_data_note).toBe(NO_DATA_NOTE);
  });
  it("says unknown on failure or timeout, never throws", async () => {
    const bad = (await annotateHits({ hits }, async () => { throw new Error("x"); })) as R;
    expect(bad.hits.map((h) => h.has_data)).toEqual(["unknown", "unknown"]);
    expect(bad.no_data_note).toBeUndefined();
    const slow = (await annotateHits({ hits }, () => new Promise(() => {}), 10)) as R;
    expect(slow.hits[0].has_data).toBe("unknown");
  });
  it("checks at most 10 hits; the rest are unknown", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ series_id: `s:${i}` }));
    let asked = 0;
    const r = (await annotateHits({ hits: many }, async (ids) => { asked = ids.length; return new Set(ids); })) as R;
    expect(asked).toBe(10);
    expect(r.hits[11].has_data).toBe("unknown");
  });
  it("passes through odd outputs unchanged", async () => {
    for (const o of [null, "x", { error: "e" }, { hits: [] }]) expect(await annotateHits(o, layer([]))).toBe(o);
  });
});

describe("sqlDataLayer", () => {
  it("matches 3-part keys by their key:geo rows", async () => {
    let q = "";
    const l = sqlDataLayer(async (s) => { q = s; return { rows: [["a:b:c:IND"], ["d:e"]] }; });
    expect([...(await l(["a:b:c", "d:e", "f:g"]))].sort()).toEqual(["a:b:c", "d:e"]);
    expect(q).toContain("starts_with(series_id, 'a:b:c:')");
  });
});

describe("withHasData", () => {
  it("wraps search_series only and unwraps MCP output", async () => {
    const tools = { search_series: { description: "d", execute: async (_i: never, _o: never) => ({ structuredContent: { hits } }) }, other: { execute: 1 } };
    const w = withHasData(tools, layer(["d:e"]));
    expect(w.other).toBe(tools.other);
    expect(w.search_series.description).toBe("d");
    const r = (await w.search_series.execute(undefined as never, undefined as never)) as unknown as R;
    expect(r.hits[1].has_data).toBe(true);
  });
});
