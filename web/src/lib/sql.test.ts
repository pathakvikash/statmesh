import { describe, expect, it } from "vitest";
import { sqlList, sqlLiteral } from "./sql";

describe("sql literals", () => {
  it("doubles single quotes", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral("x'); DROP TABLE y;--")).toBe("'x''); DROP TABLE y;--'");
  });
  it("joins lists", () => {
    expect(sqlList(["a", "b'c"])).toBe("'a', 'b''c'");
  });
});
