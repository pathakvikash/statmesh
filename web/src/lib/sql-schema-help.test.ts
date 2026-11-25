import { describe, expect, it } from "vitest";
import { FALLBACK_SCHEMA } from "./sql-schema-fallback";
import { FALLBACK_COLUMN, FALLBACK_TABLE, columnHelp, filterViews, isAdvancedTable, tableHelp } from "./sql-schema-help";

describe("sql-schema-help", () => {
  it("describes every bundled table and column without falling back", () => {
    for (const v of FALLBACK_SCHEMA.views) {
      expect(tableHelp(v.name)).not.toBe(FALLBACK_TABLE);
      for (const c of v.columns) expect(columnHelp(c.name), `${v.name}.${c.name}`).not.toBe(FALLBACK_COLUMN);
    }
  });
  it("falls back safely for unknown names", () => {
    expect(tableHelp("zzz")).toBe(FALLBACK_TABLE);
    expect(tableHelp("zzz", "from api")).toBe("from api");
    expect(columnHelp("zzz")).toBe(FALLBACK_COLUMN);
  });
  it("marks developer tables advanced", () => {
    expect(isAdvancedTable("entity_xref")).toBe(true);
    expect(isAdvancedTable("observations")).toBe(false);
  });
  it("filters by table or column text", () => {
    const all = FALLBACK_SCHEMA.views;
    expect(filterViews(all, "").length).toBe(all.length);
    const r = filterViews(all, "licence");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.cols.length > 0)).toBe(true);
    expect(filterViews(all, "qqqqzzzz")).toEqual([]);
  });
});

describe("geo help", () => {
  it("uses real code examples", () => {
    expect(columnHelp("geo")).toContain("region:EU27");
    expect(tableHelp("geos")).toContain("IND");
    expect(tableHelp("geos")).not.toMatch(/\bregion:EU\b/);
  });
});
