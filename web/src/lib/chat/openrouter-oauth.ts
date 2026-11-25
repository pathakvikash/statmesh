// "Connect OpenRouter": OAuth PKCE (S256) run entirely in the browser. Docs: openrouter.ai/docs (OAuth PKCE).
// The key is returned to the browser only and stored like a pasted one; nothing here logs or forwards it.
export const AUTH_URL = "https://openrouter.ai/auth";
export const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
export const CALLBACK_PATH = "/chat"; // the full page handles the return; the sidebar may not be mounted
const VERIFIER_KEY = "statmesh.or.verifier";
const STATE_KEY = "statmesh.or.state";

export const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** S256: base64url(SHA-256(verifier)), unpadded. */
export async function challengeFor(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** Same-origin callback only, fixed path, no query/hash: never an attacker-chosen URL. */
export function callbackUrl(origin: string): string | null {
  try {
    const u = new URL(origin);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin + CALLBACK_PATH : null;
  } catch {
    return null;
  }
}

export function authorizeUrl(callback: string, challenge: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256", state }).toString();
  return u.toString();
}

export type Callback = { kind: "none" } | { kind: "error"; message: string } | { kind: "code"; code: string };

/** Reads ?code&state from the return URL. The state must equal the one we stored, else the code is ignored. */
export function parseCallback(search: string, expectedState: string | null): Callback {
  const p = new URLSearchParams(search);
  const code = p.get("code");
  const state = p.get("state");
  if (!code && !p.has("error") && !state) return { kind: "none" };
  if (!expectedState || state !== expectedState) return code || state ? { kind: "error", message: "Sign-in response did not match this browser. Try Connect OpenRouter again." } : { kind: "none" };
  if (!code) return { kind: "error", message: "OpenRouter sign-in was cancelled." };
  return { kind: "code", code };
}

/** The exchange response: {key}. Anything else is an error; the body is never echoed. */
export function parseKeyResponse(status: number, body: unknown): { key: string } | { error: string } {
  const key = (body as { key?: unknown } | null)?.key;
  if (status >= 200 && status < 300 && typeof key === "string" && key.trim()) return { key: key.trim() };
  if (status === 403) return { error: "OpenRouter rejected the sign-in (code expired or already used). Try again." };
  return { error: "Could not get a key from OpenRouter. Try again." };
}

/** Starts the redirect. Returns an error message when it cannot. */
export async function startConnect(origin: string): Promise<string | undefined> {
  const cb = callbackUrl(origin);
  if (!cb) return "OpenRouter sign-in needs an https page (or localhost).";
  try {
    const verifier = randomToken(48);
    const state = randomToken(16);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    window.location.assign(authorizeUrl(cb, await challengeFor(verifier), state));
  } catch {
    return "This browser blocked the sign-in (storage or crypto unavailable).";
  }
}

/** On return: validates state, exchanges the code once, strips the params, clears the stored secrets. */
export async function finishConnect(): Promise<{ key: string } | { error: string } | undefined> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const cb = parseCallback(window.location.search, sessionStorage.getItem(STATE_KEY));
  if (cb.kind === "none") return undefined;
  const u = new URL(window.location.href);
  for (const k of ["code", "state", "error"]) u.searchParams.delete(k);
  window.history.replaceState(null, "", u);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (cb.kind === "error") return { error: cb.message };
  if (!verifier) return { error: "Sign-in expired. Try Connect OpenRouter again." };
  try {
    const r = await fetch(EXCHANGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: cb.code, code_verifier: verifier, code_challenge_method: "S256" }),
    });
    return parseKeyResponse(r.status, await r.json().catch(() => null));
  } catch {
    return { error: "Could not reach OpenRouter. Try again." };
  }
}
