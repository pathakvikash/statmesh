import { describe, expect, it } from "vitest";
import { buildQuery, dropGeoFilter, hasGeoFilter, type BuildQuery } from "./sql-builder";

const base: BuildQuery = { seriesKey: "mospi:plfs_annual:ur", title: "unemployment rate", unit: "%", geos: ["IN-MH", "IN-KL"], fromYear: 2015, toYear: 2024, show: "trend" };

describe("buildQuery", () => {
  it("filters on source, dataset and indicator and keeps series_id", () => {
    const { sql } = buildQuery(base);
    expect(sql).toContain("source_id = 'mospi'");
    expect(sql).toContain("dataset_id = 'plfs_annual'");
    expect(sql).toContain("indicator_id = 'ur'");
    expect(sql).toContain("geo IN ('IN-MH', 'IN-KL')");
    expect(sql).toMatch(/^SELECT series_id,/);
  });
  it("escapes quotes in every string", () => {
    const { sql } = buildQuery({ ...base, seriesKey: "a:b:O'Brien", geos: ["x'); DROP TABLE y;--"], dims: { sex: "O'Brien" } });
    expect(sql).toContain("indicator_id = 'O''Brien'");
    expect(sql).toContain("'x''); DROP TABLE y;--'");
    expect(sql).toContain("dims['sex'] = 'O''Brien'");
  });
  it("rejects bad series keys, dims keys and years", () => {
    expect(() => buildQuery({ ...base, seriesKey: "a:b" })).toThrow();
    expect(() => buildQuery({ ...base, dims: { "x'] OR 1=1 --": "a" } })).toThrow();
    for (const y of [1899, 2101, 2015.5, NaN]) expect(() => buildQuery({ ...base, fromYear: y })).toThrow(RangeError);
    expect(() => buildQuery({ ...base, fromYear: 2020, toYear: 2010 })).toThrow(RangeError);
  });
  it("always has a LIMIT of at most 5000, in every mode", () => {
    for (const show of ["latest", "trend", "compare", "topN"] as const) {
      const lim = Number(/LIMIT (\d+)$/.exec(buildQuery({ ...base, show }).sql)![1]);
      expect(lim).toBeGreaterThan(0);
      expect(lim).toBeLessThanOrEqual(5000);
    }
  });
  it("clamps n to 1..100", () => {
    const lim = (n?: number) => /LIMIT (\d+)$/.exec(buildQuery({ ...base, show: "topN", n }).sql)![1];
    expect([lim(0), lim(500), lim(-3), lim(7), lim()]).toEqual(["1", "100", "1", "7", "10"]);
  });
  it("topN without countries leaves out regional aggregates", () => {
    expect(buildQuery({ ...base, geos: [], show: "topN" }).sql).toContain("NOT LIKE 'region:%'");
  });
  it("writes a plain sentence", () => {
    const { sentence } = buildQuery({ ...base, geoNames: { "IN-MH": "Maharashtra", "IN-KL": "Kerala" } });
    expect(sentence).toContain("Shows the unemployment rate (%) for Maharashtra and Kerala each year from 2015 to 2024.");
    expect(buildQuery({ ...base, show: "latest", fromYear: undefined, toYear: undefined }).sentence).toContain("latest unemployment rate (%)");
  });
});

describe("dropGeoFilter", () => {
  const b = { seriesKey: "a:b:c", title: "x", geos: ["IND", "VNM"], show: "trend" as const };
  it("removes the place line from builder SQL only", () => {
    const sql = buildQuery(b).sql;
    expect(hasGeoFilter(sql)).toBe(true);
    const out = dropGeoFilter(sql)!;
    expect(out).toBe(buildQuery({ ...b, geos: [] }).sql);
    expect(hasGeoFilter(out)).toBe(false);
  });
  it("keeps the region guard for highest places", () => {
    expect(dropGeoFilter(buildQuery({ ...b, show: "topN" }).sql)).toBe(buildQuery({ ...b, show: "topN", geos: [] }).sql);
  });
  it("refuses hand-written SQL", () => {
    expect(dropGeoFilter("SELECT * FROM observations WHERE geo IN ('IND')")).toBeNull();
    expect(dropGeoFilter(buildQuery(b).sql + " -- x")).not.toBeNull();
  });
});

describe("topN ranking", () => {
  const sql = buildQuery({ ...base, geos: [], show: "topN" }).sql;
  it("skips regions and unmapped aggregates", () => {
    expect(sql).toContain("geo NOT LIKE 'region:%'");
    expect(sql).toContain("geo NOT LIKE 'unmapped:%'");
  });
  it("ranks one row per place, and says so", () => {
    expect(sql).toContain("PARTITION BY geo ORDER BY period_start DESC, value DESC");
    expect(sql).not.toContain("CAST(dims AS VARCHAR)");
    expect(buildQuery({ ...base, geos: [], show: "topN" }).sentence).toContain("only its largest is counted");
    expect(buildQuery({ ...base, geos: [], show: "topN", dims: { a: "b" } }).sentence).not.toContain("largest");
  });
  it("empty dims value means the breakdown is absent", () => {
    expect(buildQuery({ ...base, dims: { religion: "" } }).sql).toContain("dims['religion'] IS NULL");
  });
});

describe("dropGeoFilter robustness", () => {
  it("is fast on long place lists, even with quotes", () => {
    const geos = Array.from({ length: 40 }, (_, i) => `a''${i}'`);
    const sql = "SELECT series_id, geo, period_start, value, unit, dims\nFROM observations\nWHERE source_id = 'a'\n  AND geo IN (" + geos.map((g) => `'${g}'`).join(", ") + ")\n  AND x = 1\n\nLIMIT 5";
    const t = performance.now();
    expect(dropGeoFilter(sql)).toBeNull(); // not builder-shaped (prefix), but the regex must not hang either
    const built = buildQuery({ seriesKey: "a:b:c", title: "x", geos: Array.from({ length: 40 }, (_, i) => `x'${i}`), show: "latest" }).sql;
    expect(dropGeoFilter(built)).toBe(buildQuery({ seriesKey: "a:b:c", title: "x", geos: [], show: "latest" }).sql);
    expect(performance.now() - t).toBeLessThan(100);
  });
  it("removes only the geo line, leaving other blank lines alone", () => {
    const q = buildQuery({ seriesKey: "a:b:c", title: "x", geos: ["IND"], show: "latest", dims: { k: "v" } }).sql.replace("LIMIT", "\n\nLIMIT");
    expect(dropGeoFilter(q)).toBe(q.replace(/  AND geo IN \('IND'\)\n/, ""));
  });
});
