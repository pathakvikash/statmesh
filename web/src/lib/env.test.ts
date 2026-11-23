import { expect, it } from "vitest";
import { envProblems, webEnv } from "./env";

it("defaults and strips trailing slashes", () => {
  const e = webEnv({});
  expect(e.apiUrl).toBe("http://localhost:8000");
  expect(e.siteUrl).toBe("http://localhost:3000");
  expect(e.hosted).toBe(false);
  expect(webEnv({ STATMESH_API_URL: "https://a.example.com/" }).apiUrl).toBe("https://a.example.com");
});

it("hosted comes from STATMESH_MODE, or VERCEL when unset", () => {
  expect(webEnv({ VERCEL: "1" }).hosted).toBe(true);
  expect(webEnv({ VERCEL: "1", STATMESH_MODE: "self_host" }).hosted).toBe(false);
  expect(webEnv({ STATMESH_MODE: "hosted" }).hosted).toBe(true);
});

it("reports no problems for a sane hosted config and local default", () => {
  expect(envProblems({})).toEqual([]);
  expect(envProblems({ STATMESH_MODE: "hosted", STATMESH_API_URL: "https://api.example.com", STATMESH_SITE_URL: "https://s.example.com" })).toEqual([]);
});

it("flags hosted with localhost URLs, bad schemes, bad flags", () => {
  const p = envProblems({ STATMESH_MODE: "hosted" });
  expect(p.some((x) => x.includes("localhost STATMESH_API_URL"))).toBe(true);
  expect(p.some((x) => x.includes("STATMESH_SITE_URL"))).toBe(true);
  expect(envProblems({ STATMESH_API_URL: "ftp://x.example.com" })[0]).toMatch(/http or https/);
  expect(envProblems({ STATMESH_API_URL: "nope" })[0]).toMatch(/not a valid URL/);
  expect(envProblems({ STATMESH_MODE: "hostd" })[0]).toMatch(/STATMESH_MODE/);
  expect(envProblems({ STATMESH_ALLOW_SERVER_KEY: "true" })[0]).toMatch(/exactly "1"/);
});

it("never echoes key values", () => {
  const e = webEnv({ ANTHROPIC_API_KEY: "sk-secret" });
  expect(e.hasAnthropicKey).toBe(true);
  expect(JSON.stringify(e)).not.toContain("sk-secret");
});
