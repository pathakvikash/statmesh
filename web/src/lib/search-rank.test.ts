import { describe, expect, it } from "vitest";
import { isDatasetId, rankByData } from "./search-rank";

describe("rankByData", () => {
  it("puts data first, keeps order within groups", () => {
    const r = rankByData([1, 2, 3, 4, 5], (n) => n % 2 === 0);
    expect(r).toEqual({ ranked: [2, 4, 1, 3, 5], withData: 2 });
  });
  it("handles empty", () => expect(rankByData([], () => true)).toEqual({ ranked: [], withData: 0 }));
});
describe("isDatasetId", () => {
  it("detects two-part ids", () => {
    expect(isDatasetId("who:GHO")).toBe(true);
    expect(isDatasetId("who:GHO:WHOSIS_1")).toBe(false);
  });
});
