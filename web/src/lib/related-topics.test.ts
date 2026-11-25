import { describe, expect, it } from "vitest";
import { relatedTopics } from "./related-topics";

describe("relatedTopics", () => {
  it("maps hardware keywords to broader topics", () => {
    expect(relatedTopics("3d printing")).toEqual(["research and development", "manufacturing", "trade in goods"]);
    expect(relatedTopics("RC car")).toContain("manufacturing");
  });
  it("maps internet words and skips the query itself", () => {
    expect(relatedTopics("internet")).toEqual(["ICT", "telecommunications"]);
  });
  it("dedupes across groups and caps the list", () => {
    const r = relatedTopics("robot patent car", 4);
    expect(r).toHaveLength(4);
    expect(new Set(r).size).toBe(4);
  });
  it("returns nothing for unknown words", () => {
    expect(relatedTopics("zzz")).toEqual([]);
    expect(relatedTopics("")).toEqual([]);
  });
});
