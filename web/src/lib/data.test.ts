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
