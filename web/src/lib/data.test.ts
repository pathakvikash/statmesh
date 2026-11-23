import { describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ unstable_cache: (f: unknown) => f }));
vi.mock("./client", () => ({ sql: sqlMock, search: vi.fn(), sources: vi.fn() }));
import { hitStats } from "./data";

const cols = ["series_id", "source_id", "freq", "geos", "subgeos", "start_d", "end_d", "retrieved", "unit", "um", "ts", "med", "ns", "wv", "tg", "tv"];
describe("multi-geo stats: one query for card and page", () => {
  it("builds periods from every period of g (World-only kept) and reads the headline from that row", async () => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce({ columns: [], rows: [] }); // single-series pass finds nothing
    sqlMock.mockResolvedValueOnce({ columns: cols, rows: [["a:b:c", "a", "A", 84, 0, "2000", "2020", "2024-01-01", null, null, ["2019", "2020"], [null, 1.842], [0, 84], [null, null], ["IND"], [5]]] });
    const s = (await hitStats(["a:b:c"]))["a:b:c"];
    const q = String(sqlMock.mock.calls[1][0]);
    expect(q).toContain("SELECT DISTINCT key, period_start FROM g");
    expect(q).toContain("LEFT JOIN per p");
    expect(s.multi?.headline).toMatchObject({ kind: "median", value: 1.842, count: 84 });
    expect(s.multi?.sub).toBe(false);
  });
});

import { seriesShape } from "./data";
describe("seriesShape: one bounded query, literal-escaped key", () => {
  it("matches the key and its geo suffix, escapes quotes, reads status from the datasets table", async () => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce({ columns: [], rows: [] });
    const s = await seriesShape("a:b:it's");
    expect(sqlMock).toHaveBeenCalledTimes(1);
    const q = String(sqlMock.mock.calls[0][0]);
    expect(q).toContain("starts_with(series_id, 'a:b:it''s:')");
    expect(q).toContain("series_key = 'a:b:it''s'");
    expect(q).toContain("map_keys(dims)");
    expect(s).toBeNull(); // no result row
  });
});

import { sourceDatasets, sourceDatasetsSql } from "./data";
describe("sourceDatasets: literal-escaped id, failures give []", () => {
  it("quotes an id containing a single quote", async () => {
    expect(sourceDatasetsSql("o'brien")).toContain("d.source_id = 'o''brien'");
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce({ columns: ["dataset_id", "title", "status", "freq", "last_ingested_at", "series"], rows: [["d1", "T", "fresh", "A", null, 3]] });
    expect(await sourceDatasets("o'brien")).toEqual([{ id: "d1", title: "T", status: "fresh", freq: "A", lastIngested: null, series: 3 }]);
    expect(String(sqlMock.mock.calls[0][0])).toContain("'o''brien'");
    sqlMock.mockRejectedValueOnce(new Error("x"));
    expect(await sourceDatasets("a")).toEqual([]);
  });
});

import { newestBySource, type SeriesStat } from "./data";
describe("newestBySource", () => {
  it("keeps the first (newest) stat per source", () => {
    const st = (id: string, source_id: string | null) => ({ id, source_id }) as SeriesStat;
    const m = newestBySource([st("new", "a"), st("old", "a"), st("b1", "b"), st("x", null)]);
    expect(m.get("a")?.id).toBe("new");
    expect([...m.keys()]).toEqual(["a", "b"]);
  });
});

import { candidateKeysSql, featuredPickSql, latestUpdates, orElse } from "./data";
describe("latestUpdates is bounded", () => {
  it("probes catalog keys per source and never scans all observations", async () => {
    expect(candidateKeysSql(2)).toContain("<= 2");
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce({ columns: ["series_key", "title"], rows: [["a:b:c", "T"], ["a:b:d", "U"]] });
    sqlMock.mockResolvedValueOnce({ columns: cols, rows: [["a:b:c", "a", "A", 5, 0, "2000", "2020", "2024-01-01", null, null, ["2018", "2019", "2020"], [1, 2, 3], [5, 5, 5], [null, null, null], ["IND"], [5]]] });
    const out = await latestUpdates();
    const q = String(sqlMock.mock.calls[1][0]);
    expect(q).toContain("o.source_id IN ('a')");
    expect(q).not.toContain("sec_edgar");
    expect(out.map((s) => [s.id, s.title])).toEqual([["a:b:c", "T"]]);
  });
});

describe("candidate selection and failure handling", () => {
  it("filters sparse indicators inside the candidate subquery", () => {
    expect(candidateKeysSql()).toContain("HAVING count(DISTINCT period_start) >= 3 OR count(DISTINCT geo) >= 3");
    expect(featuredPickSql()).toContain("g >= 2 AND np >= 3");
  });
  it("latestUpdates throws on empty (never cached) and orElse swallows it", async () => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue({ columns: ["series_key", "title"], rows: [] });
    await expect(latestUpdates()).rejects.toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await orElse("x", () => latestUpdates(), [])).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

import { medianByPeriod } from "./data";
describe("medianByPeriod: computed median over countries", () => {
  const info = { freq: "A", dk: "y", rawUnit: "PCT", unitMult: 1 } as Parameters<typeof medianByPeriod>[1];
  it("excludes regions and unmapped geos, maps rows, drops non-finite medians", async () => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValueOnce({ columns: ["t", "med", "n"], rows: [["2019", 70.5, 180], ["2020", "x", 0], ["2021", 71, 181]] });
    expect(await medianByPeriod("a:b:c", info)).toEqual([{ t: "2019", med: 70.5, n: 180 }, { t: "2021", med: 71, n: 181 }]);
    const q = String(sqlMock.mock.calls[0][0]);
    expect(q).toContain("quantile_cont(v, 0.5)");
    expect(q).toContain("NOT starts_with(geo, 'region:')");
    expect(q).toContain("NOT starts_with(geo, 'unmapped:')");
    expect(q).toContain("unit = 'PCT'"); // never mixes units or multipliers across countries
    expect(q).toContain("unit_mult = 1");
  });
  it("gives [] when the query fails", async () => {
    sqlMock.mockReset();
    sqlMock.mockRejectedValueOnce(new Error("x"));
    expect(await medianByPeriod("a:b:c", info)).toEqual([]);
  });
});
