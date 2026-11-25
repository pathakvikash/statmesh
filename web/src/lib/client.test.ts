import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheInit } from "./client";
import { noApiFilter, sourcesApiParams, parseSourceFilters } from "./params";

const cached = { next: { revalidate: 300 } };
const noStore = { cache: "no-store" };
describe("cacheInit: web cache flag", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("no-store by default (local install)", () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("STATMESH_WEB_CACHE", "");
    expect(cacheInit("/sources")).toEqual(noStore);
  });
  it("cached on Vercel, unless STATMESH_WEB_CACHE=0", () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("STATMESH_WEB_CACHE", "");
    expect(cacheInit("/sources")).toEqual(cached);
    vi.stubEnv("STATMESH_WEB_CACHE", "0");
    expect(cacheInit("/sources")).toEqual(noStore);
  });
  it("STATMESH_WEB_CACHE=1 forces it on locally", () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("STATMESH_WEB_CACHE", "1");
    expect(cacheInit("/search?q=x")).toEqual(cached);
  });
});
describe("cacheInit: only idempotent catalogue GETs are cached", () => {
  beforeEach(() => { vi.stubEnv("STATMESH_WEB_CACHE", "1"); });
  afterEach(() => vi.unstubAllEnvs());
  it.each(["/search?q=gdp", "/sources", "/sources?q=x", "/series/a:b:c", "/series/a:b:c/related?limit=5", "/graph?expand=x", "/geos"])("caches %s", (p) => {
    expect(cacheInit(p)).toEqual(cached);
  });
  it.each(["/series/a:b:c/observations?limit=1", "/series/a:b:c/observations.csv", "/healthz", "/ready", "/schema", "/shares/x", "/chat"])("no-store for %s", (p) => {
    expect(cacheInit(p)).toEqual({ cache: "no-store" });
  });
  it("no-store for POST even on a cacheable path", () => {
    expect(cacheInit("/search", { method: "POST" })).toEqual({ cache: "no-store" });
  });
});
describe("sources page reuses the cached list when unfiltered", () => {
  it("noApiFilter", () => {
    expect(noApiFilter(sourcesApiParams(parseSourceFilters({})))).toBe(true);
    expect(noApiFilter(sourcesApiParams(parseSourceFilters({ q: "oecd" })))).toBe(false);
    expect(noApiFilter(sourcesApiParams(parseSourceFilters({ topic: "Economy" })))).toBe(false);
  });
});
