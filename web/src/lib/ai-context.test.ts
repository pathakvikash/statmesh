import { describe, expect, it } from "vitest";
import { buildPageContext, fencedSql, parsePageContext, quickPrompts, sqlEditorText, sqlWorkbenchHref, SQL_LINK_MAX } from "./ai-context";

describe("buildPageContext", () => {
  it("reads a series page: id from the path, title from the caller, params from the URL", () => {
    const c = buildPageContext("/series/owid:grapher:life-expectancy", "?geos=IND,BGD&range=2000-2020&freq=A", { title: "Life expectancy" });
    expect(c).toEqual({ kind: "series", seriesId: "owid:grapher:life-expectancy", title: "Life expectancy", geos: "IND,BGD", range: "2000-2020", freq: "A" });
  });
  it("decodes an encoded series id and drops empty params", () => {
    const c = buildPageContext("/series/owid%3Agrapher%3Ax", "?dims=");
    expect(c).toEqual({ kind: "series", seriesId: "owid:grapher:x" });
  });
  it("reads search from home with a query, leaving q out of the filters", () => {
    expect(buildPageContext("/", "?q=unemployment&source=ilostat")).toEqual({ kind: "search", query: "unemployment", filters: { source: "ilostat" } });
  });
  it("treats the home page without a query as home", () => {
    expect(buildPageContext("/", "")).toEqual({ kind: "home" });
  });
  it("reads the SQL page with the editor text, capped", () => {
    expect(buildPageContext("/sql", "", { sql: "SELECT 1" })).toEqual({ kind: "sql", sql: "SELECT 1" });
    const long = buildPageContext("/sql", "", { sql: "x".repeat(5000) });
    expect(long.kind === "sql" && long.sql?.length).toBe(1200);
  });
  it("reads sources with filters", () => {
    expect(buildPageContext("/sources", "?topic=labour")).toEqual({ kind: "sources", filters: { topic: "labour" } });
  });
  it("reads a source page as a sources context with its id", () => {
    expect(buildPageContext("/sources/world%20bank", "")).toEqual({ kind: "sources", filters: { source: "world bank" } });
  });
  it("falls back to home for other pages, including chat", () => {
    expect(buildPageContext("/chat", "?q=x")).toEqual({ kind: "home" });
    expect(buildPageContext("/series/", "")).toEqual({ kind: "home" });
  });
});

describe("parsePageContext", () => {
  it("accepts each valid kind", () => {
    for (const raw of [
      { kind: "series", seriesId: "a:b", title: "T" },
      { kind: "search", query: "gdp", filters: { source: "wb" } },
      { kind: "sql", sql: "SELECT 1" },
      { kind: "sources" },
      { kind: "home" },
    ]) expect(parsePageContext(raw).ok).toBe(true);
  });
  it("treats a missing context as home", () => {
    expect(parsePageContext(undefined)).toEqual({ ok: true, value: { kind: "home" } });
  });
  it("rejects unknown keys", () => {
    expect(parsePageContext({ kind: "home", apiKey: "secret" }).ok).toBe(false);
    expect(parsePageContext({ kind: "series", seriesId: "a", extra: 1 }).ok).toBe(false);
  });
  it("rejects oversize strings and unknown kinds", () => {
    expect(parsePageContext({ kind: "series", seriesId: "x".repeat(201) }).ok).toBe(false);
    expect(parsePageContext({ kind: "sql", sql: "x".repeat(1201) }).ok).toBe(false);
    expect(parsePageContext({ kind: "settings" }).ok).toBe(false);
    expect(parsePageContext("home").ok).toBe(false);
  });
  it("rejects too many filters", () => {
    const filters = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "v"]));
    expect(parsePageContext({ kind: "search", filters }).ok).toBe(false);
  });
});

describe("sqlWorkbenchHref", () => {
  it("builds an encoded run link", () => {
    expect(sqlWorkbenchHref("SELECT 1 & 2")).toBe("/sql?sql=SELECT%201%20%26%202&run=1");
  });
  it("returns null for empty or over-cap SQL", () => {
    expect(sqlWorkbenchHref("   ")).toBeNull();
    expect(sqlWorkbenchHref("x".repeat(SQL_LINK_MAX + 1))).toBeNull();
    expect(sqlWorkbenchHref("x".repeat(SQL_LINK_MAX))).not.toBeNull();
  });
});

describe("fencedSql", () => {
  it("pulls out sql fences only", () => {
    const text = "Try this:\n```sql\nSELECT 1\n```\nand\n```python\nprint(1)\n```";
    expect(fencedSql(text)).toEqual(["SELECT 1"]);
  });
});

describe("quickPrompts", () => {
  it("offers the series prompts", () => {
    expect(quickPrompts({ kind: "series", seriesId: "a" }).map((p) => p.text)).toContain("Write SQL to compare the top 5 countries");
  });
  it("uses the search query in the best-for prompt", () => {
    expect(quickPrompts({ kind: "search", query: "water" })[0].text).toBe("Which of these is best for water?");
  });
  it("fills the composer for the open-ended SQL prompt", () => {
    const p = quickPrompts({ kind: "sql" }).find((x) => x.label === "Write a query for ...");
    expect(p).toMatchObject({ text: "Write a query for ", fill: true });
  });
  it("offers one home prompt", () => {
    expect(quickPrompts({ kind: "home" })).toEqual([{ label: "What can I ask here?", text: "What can I ask here?", fill: false }]);
  });
});

describe("sqlEditorText store", () => {
  it("gets what was set and notifies subscribers on change only", () => {
    let calls = 0;
    const off = sqlEditorText.subscribe(() => calls++);
    sqlEditorText.set("SELECT 2");
    sqlEditorText.set("SELECT 2");
    expect(sqlEditorText.get()).toBe("SELECT 2");
    expect(calls).toBe(1);
    off();
    sqlEditorText.set("");
    expect(calls).toBe(1);
  });
});
