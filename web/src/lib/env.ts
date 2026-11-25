// Typed, validated view of the web server's env. Same semantics as the scattered reads in mode.ts,
// client.ts and chat/*: this module only centralises them. Never exposes key values, only presence.
type Env = Record<string, string | undefined>;

export type WebEnv = {
  apiUrl: string;
  siteUrl: string;
  hosted: boolean;
  /** STATMESH_MODE as set, "" when unset. */
  mode: string;
  allowServerKey: boolean;
  claudeBin: string | undefined;
  onVercel: boolean;
  /** Cache catalogue reads 5 min: on when VERCEL or STATMESH_WEB_CACHE=1, off when STATMESH_WEB_CACHE=0. */
  webCache: boolean;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
};

const strip = (v: string) => v.replace(/\/$/, "");
const isLocalHost = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  } catch {
    return false;
  }
};
const badUrl = (u: string): string | null => {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:" ? null : "must use http or https";
  } catch {
    return "is not a valid URL";
  }
};

export function webEnv(env: Env = process.env): WebEnv {
  const mode = env.STATMESH_MODE || "";
  return {
    apiUrl: strip(env.STATMESH_API_URL ?? "http://localhost:8000"),
    siteUrl: strip(env.STATMESH_SITE_URL ?? "http://localhost:3000"),
    hosted: (mode || (env.VERCEL ? "hosted" : "")) === "hosted",
    mode,
    allowServerKey: env.STATMESH_ALLOW_SERVER_KEY === "1",
    claudeBin: env.STATMESH_CLAUDE_BIN || undefined,
    onVercel: !!env.VERCEL,
    webCache: env.STATMESH_WEB_CACHE === "1" || (env.STATMESH_WEB_CACHE !== "0" && !!env.VERCEL),
    hasAnthropicKey: !!env.ANTHROPIC_API_KEY?.trim(),
    hasOpenaiKey: !!env.OPENAI_API_KEY?.trim(),
  };
}

export function envProblems(env: Env = process.env): string[] {
  const e = webEnv(env);
  const out: string[] = [];
  if (e.mode && e.mode !== "hosted" && e.mode !== "self_host") out.push(`STATMESH_MODE="${e.mode}" is not "hosted" or "self_host" (treated as not hosted)`);
  for (const [name, val] of [["STATMESH_API_URL", e.apiUrl], ["STATMESH_SITE_URL", e.siteUrl]] as const) {
    const bad = badUrl(val);
    if (bad) out.push(`${name} ${bad}`);
  }
  const a = env.STATMESH_ALLOW_SERVER_KEY;
  if (a && a !== "1") out.push('STATMESH_ALLOW_SERVER_KEY must be exactly "1" to take effect');
  if (e.hosted) {
    if (isLocalHost(e.apiUrl)) out.push("hosted mode with a localhost STATMESH_API_URL: the deployment cannot reach it");
    if (isLocalHost(e.siteUrl)) out.push("hosted mode with a localhost STATMESH_SITE_URL: sitemap and share links will be wrong");
    if (e.allowServerKey) out.push("hosted mode with STATMESH_ALLOW_SERVER_KEY=1: the server's provider keys are usable by anyone");
  } else if (e.allowServerKey) out.push("STATMESH_ALLOW_SERVER_KEY has no effect outside hosted mode");
  if (e.hosted && e.claudeBin) out.push("STATMESH_CLAUDE_BIN is ignored in hosted mode");
  return out;
}
