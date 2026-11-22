import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/** Does the claude binary resolve (STATMESH_CLAUDE_BIN, else `claude` on PATH)? Lookup only, no spawn. */
export async function claudeFound(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const ok = (f: string) => { try { accessSync(f, constants.X_OK); return true; } catch { return false; } };
  const bin = env.STATMESH_CLAUDE_BIN;
  if (bin) return isAbsolute(bin) ? ok(bin) : (env.PATH ?? "").split(delimiter).some((d) => d && ok(join(d, bin)));
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  return (env.PATH ?? "").split(delimiter).some((d) => d && names.some((n) => ok(join(d, n))));
}
