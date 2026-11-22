import { existsSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const { generateText, claudeCode } = vi.hoisted(() => ({ generateText: vi.fn(), claudeCode: vi.fn(() => ({})) }));
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText }));
vi.mock("ai-sdk-provider-claude-code", async (orig) => ({ ...(await orig<typeof import("ai-sdk-provider-claude-code")>()), claudeCode }));
import { generateViaCli } from "./claude-cli";

const o = { model: "haiku", instructions: "i", prompt: "p" };
beforeEach(() => { generateText.mockReset(); claudeCode.mockClear(); });
const cwdOf = () => (claudeCode.mock.calls[0] as unknown as [string, { cwd: string; mcpServers: object }])[1];

it("strips fences, caps at 4000, uses a hardened cwd and removes it", async () => {
  generateText.mockResolvedValue({ text: "```sql\n" + "x".repeat(5000) + "\n```" });
  const sql = await generateViaCli(o);
  expect(sql).toHaveLength(4000);
  expect(sql.startsWith("```")).toBe(false);
  const opts = cwdOf();
  expect(opts.mcpServers).toEqual({});
  expect(existsSync(opts.cwd)).toBe(false);
});

it("removes the temp dir when the model call throws", async () => {
  generateText.mockRejectedValue(new Error("boom"));
  await expect(generateViaCli(o)).rejects.toThrow("boom");
  expect(existsSync(cwdOf().cwd)).toBe(false);
});

it("passes an abort signal that follows the caller's", async () => {
  generateText.mockResolvedValue({ text: "SELECT 1" });
  const ac = new AbortController();
  await generateViaCli({ ...o, signal: ac.signal });
  const sig = (generateText.mock.calls[0][0] as { abortSignal: AbortSignal }).abortSignal;
  expect(sig.aborted).toBe(false);
  ac.abort();
  expect(sig.aborted).toBe(true);
});
