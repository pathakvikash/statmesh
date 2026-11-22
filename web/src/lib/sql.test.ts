import { describe, expect, it } from "vitest";
import { cleanReply, looksLikeSql, sqlList, sqlLiteral, valueCompletions } from "./sql";
import { sourceStarters } from "./sql-templates";

describe("sql literals", () => {
  it("doubles single quotes", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral("x'); DROP TABLE y;--")).toBe("'x''); DROP TABLE y;--'");
  });
  it("joins lists", () => {
    expect(sqlList(["a", "b'c"])).toBe("'a', 'b''c'");
  });
});

describe("looksLikeSql", () => {
  it("accepts SQL starts, ignoring case and leading space", () => {
    for (const s of ["SELECT 1", "  select 1", "WITH a AS (SELECT 1) SELECT * FROM a", "from observations", "(SELECT 1)", "-- hi\nSELECT 1", "/* c */ SELECT 1", "; select 1", "VALUES (1)", "SUMMARIZE observations", "DESCRIBE datasets", "from datasets", "FROM observations WHERE x = 1"]) expect(looksLikeSql(s)).toBe(true);
  });
  it("rejects plain language", () => {
    for (const s of ["unemployment in Vietnam", "selection of countries", "", "what is the inflation rate", "From 2015, unemployment in India", "from India to Vietnam", "from the start", "/* only a comment */"]) expect(looksLikeSql(s)).toBe(false);
  });
});

describe("valueCompletions", () => {
  const src = ["bis", "bea", "imf"];
  it("suggests after source_id = '", () => {
    expect(valueCompletions("SELECT * FROM observations WHERE source_id = '", src)).toEqual({ from: 46, options: src });
    expect(valueCompletions("WHERE source_id='b", src)).toEqual({ from: 17, options: ["bis", "bea"] });
  });
  it("suggests inside IN (...)", () => {
    expect(valueCompletions("WHERE source_id IN ('imf', 'b", src)?.options).toEqual(["bis", "bea"]);
    expect(valueCompletions("WHERE source_id IN ('", src)?.options).toEqual(src);
  });
  it("nothing elsewhere", () => {
    expect(valueCompletions("WHERE geo = '", src)).toBeNull();
    expect(valueCompletions("WHERE source_id = 'imf'", src)).toBeNull();
    expect(valueCompletions("WHERE source_id = 'zzz", src)).toBeNull();
  });
});

describe("cleanReply", () => {
  it("strips fences and caps length", () => {
    expect(cleanReply("```sql\nSELECT 1\n```")).toBe("SELECT 1");
    expect(cleanReply("x".repeat(5000))).toHaveLength(4000);
  });
});

describe("sourceStarters", () => {
  it("returns three queries and quotes the id", () => {
    const q = sourceStarters("o'x");
    expect(q).toHaveLength(3);
    for (const t of q) expect(t.sql).toContain("source_id = 'o''x'");
  });
});
