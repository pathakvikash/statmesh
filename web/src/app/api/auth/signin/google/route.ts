import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authEnv, SCOPES } from "@/lib/auth-core";
import { cookieOpts, names, originOf, safeCallbackUrl, signToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
const b64 = (b: Buffer) => b.toString("base64url");

/** Starts the OAuth2 authorization-code + PKCE flow. GET /api/auth/signin/google?callbackUrl=/path */
export async function GET(req: Request) {
  const env = authEnv();
  if (!env) return new NextResponse(null, { status: 404 });
  const origin = originOf(req);
  const state = b64(randomBytes(24)), nonce = b64(randomBytes(24)), verifier = b64(randomBytes(32));
  const flow = await signToken({ state, nonce, verifier, cb: safeCallbackUrl(new URL(req.url).searchParams.get("callbackUrl")) }, 600, "flow");
  const q = new URLSearchParams({
    client_id: env.clientId, redirect_uri: `${origin}/api/auth/callback/google`, response_type: "code", scope: SCOPES,
    state, nonce, code_challenge: b64(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", prompt: "select_account",
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, 302);
  res.cookies.set(names(origin).flow, flow!, cookieOpts(origin, 600));
  return res;
}
