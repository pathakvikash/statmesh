import { describe, expect, it } from "vitest";
import { pageContextParagraph, SYSTEM_PROMPT } from "./prompt";
import { scopeParagraph } from "./scope";

describe("SYSTEM_PROMPT", () => {
  it("keeps the no-memory rule and the no-data reply rule", () => {
    expect(SYSTEM_PROMPT).toContain("Never state a number from memory");
    expect(SYSTEM_PROMPT).toContain("no matching data");
    expect(SYSTEM_PROMPT).toContain("up to 3 closest series");
    expect(SYSTEM_PROMPT).toContain("which source might hold");
  });
  it("takes the scope paragraph appended", () => {
    const p = SYSTEM_PROMPT + scopeParagraph({ geos: ["IND"], start: "2015-01-01", end: "2019-12-31" });
    expect(p.endsWith("Stay inside this scope: countries IND; years 2015 to 2019. If the answer lies outside it, say so.")).toBe(true);
  });
  it("adds the page context for a series, and nothing for home", () => {
    expect(pageContextParagraph({ kind: "home" })).toBe("");
    const p = pageContextParagraph({ kind: "series", seriesId: "a:b" });
    expect(p).toContain('{"kind":"series","seriesId":"a:b"}');
    expect(p).toContain("All rules above still apply");
  });
});
