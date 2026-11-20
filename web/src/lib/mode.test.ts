import { afterEach, expect, it, vi } from "vitest";
import { isHosted } from "./mode";

afterEach(() => vi.unstubAllEnvs());

it("treats an unset or empty STATMESH_MODE on Vercel as hosted; any other value wins", () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("STATMESH_MODE", "");
  expect(isHosted()).toBe(true);
  vi.stubEnv("STATMESH_MODE", "hostd");
  expect(isHosted()).toBe(false);
  vi.stubEnv("STATMESH_MODE", "hosted");
  expect(isHosted()).toBe(true);
});

it("is not hosted off Vercel unless STATMESH_MODE=hosted", () => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("STATMESH_MODE", "");
  expect(isHosted()).toBe(false);
});
