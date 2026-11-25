import { describe, expect, it } from "vitest";
import { fmtCell } from "./sql-csv";

describe("fmtCell", () => {
  it("keeps years plain in year-like columns", () => {
    for (const c of ["year(period_start)", "fy", "period", "year", "period_start_date"]) expect(fmtCell(2024, c), c).toBe("2024");
  });
  it("still groups other numbers", () => {
    expect(fmtCell(2024, "value")).toBe("2,024");
    expect(fmtCell(1234567, "year(period_start)")).toBe("12,34,567");
    expect(fmtCell(2024.5, "year")).toBe("2,024.5");
  });
  it("leaves strings and nulls", () => {
    expect(fmtCell("2024", "year")).toBe("2024");
    expect(fmtCell(null, "x")).toBe("");
  });
});
