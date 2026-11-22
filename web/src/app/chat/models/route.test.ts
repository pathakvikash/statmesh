import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());
const cliFlag = async () => (await (await GET()).json()).cli;

it("offers the CLI only when not hosted and the claude binary resolves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("STATMESH_MODE", "hosted");
  vi.stubEnv("STATMESH_CLAUDE_BIN", bin);
  expect(await cliFlag()).toBe(false); // hosted wins even with a binary
  vi.stubEnv("STATMESH_MODE", "local");
  expect(await cliFlag()).toBe(true);
  vi.stubEnv("VERCEL", "1");
  expect(await cliFlag()).toBe(false);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("STATMESH_CLAUDE_BIN", join(dir, "missing"));
  expect(await cliFlag()).toBe(false); // not installed
  const j = await (await GET()).json();
  expect(Object.keys(j.serverKey)).toEqual(["anthropic", "openai"]);
  rmSync(dir, { recursive: true, force: true });
});
