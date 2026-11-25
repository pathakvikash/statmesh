import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./sql-examples";
import { looksLikeSql } from "./sql";

describe("sql examples", () => {
  it("have unique ids and valid SQL with a row limit or grouping", () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) {
      expect(looksLikeSql(e.sql), e.id).toBe(true);
      expect(/\bLIMIT \d+/.test(e.sql) || /GROUP BY/.test(e.sql), e.id).toBe(true);
    }
  });
  it("pin a breakdown for every series that has several", () => {
    const sqlOf = (id: string) => EXAMPLES.find((e) => e.id === id)!.sql;
    expect(sqlOf("lfpr-india-monthly")).toContain("dims['gender'] = 'person'");
    expect(sqlOf("gdp-india")).toContain("dims['revision']");
    expect(sqlOf("unemployment-india")).toContain("dims['social_group'] IS NULL");
    expect(EXAMPLES.some((e) => e.id === "cpi-inflation-india" || e.id === "wholesale-prices-india")).toBe(false);
  });
  it("cover every group", () => {
    expect(new Set(EXAMPLES.map((e) => e.group)).size).toBe(5);
  });
});
