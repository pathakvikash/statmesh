import { describe, expect, it } from "vitest";
import { SQL_CONTEXT_MAX } from "./ai-context";
import { askPrompt, explainPrompt, nextTab, tabFromParams, tabHref } from "./sql-ai";

describe("sql-ai", () => {
  it("defaults to the Ask tab; sql or mode=sql opens Advanced", () => {
    expect(tabFromParams({})).toBe("ask");
    expect(tabFromParams({ sql: "SELECT 1" })).toBe("sql");
    expect(tabFromParams({ mode: "sql" })).toBe("sql");
    expect(tabFromParams({ mode: "x", sql: "" })).toBe("ask");
  });
  it("arrow keys switch tabs", () => {
    expect(nextTab("ArrowRight", "ask")).toBe("sql");
    expect(nextTab("ArrowLeft", "ask")).toBe("sql");
    expect(nextTab("Home", "sql")).toBe("ask");
    expect(nextTab("a", "ask")).toBeNull();
  });
  it("builds prompts and caps the SQL", () => {
    expect(askPrompt(" hi ")).toContain("```sql block, then explain it in two sentences: hi");
    expect(explainPrompt("x".repeat(5000)).length).toBeLessThan(SQL_CONTEXT_MAX + 200);
  });
});

describe("tabHref", () => {
  it("keeps sql and run going to Advanced", () => {
    expect(tabHref("sql", "?sql=SELECT+1&run=1")).toBe("/sql?sql=SELECT+1&run=1&mode=sql");
    expect(tabHref("sql", "")).toBe("/sql?mode=sql");
  });
  it("drops them going back, keeps other params", () => {
    expect(tabHref("ask", "?sql=SELECT+1&run=1&mode=sql")).toBe("/sql");
    expect(tabHref("ask", "?mode=sql&utm=x")).toBe("/sql?utm=x");
  });
});
