import { describe, expect, it } from "vitest";
import { cleanQuestion } from "./ask";

describe("cleanQuestion", () => {
  it("returns null for empty or blank input", () => {
    expect(cleanQuestion("")).toBeNull();
    expect(cleanQuestion("  \n ")).toBeNull();
    expect(cleanQuestion(undefined)).toBeNull();
  });
  it("trims, collapses whitespace and caps length", () => {
    expect(cleanQuestion("  GDP   of\nIndia ")).toBe("GDP of India");
    expect(cleanQuestion("x".repeat(600))).toHaveLength(500);
  });
});
