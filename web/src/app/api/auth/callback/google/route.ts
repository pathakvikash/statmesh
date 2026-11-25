import { NextResponse } from "next/server";
import { authEnv, SESSION_MAX_AGE } from "@/lib/auth-core";
import { cookieOpts, names, originOf, sessionToken, userFromIdToken, verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Validates state + PKCE, exchanges the code, verifies the id_token, sets the session cookie. */
export async function GET(req: Request) {
  const env = authEnv();
  if (!env) return new NextResponse(null, { status: 404 });
  const origin = originOf(req);
  const n = names(origin);
  const fail = (why: string) => {
    const r = NextResponse.redirect(`${origin}/?auth_error=${why}`, 303);
    r.cookies.set(n.flow, "", cookieOpts(origin, 0));
    return r;
  };
  const url = new URL(req.url);
  const jar = req.headers.get("cookie") ?? "";
  const flowCookie = jar.split(/;\s*/).find((c) => c.startsWith(`${n.flow}=`))?.slice(n.flow.length + 1);
  const flow = await verifyToken(flowCookie, "flow");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !flow || !code) return fail("denied");
  if (url.searchParams.get("state") !== flow.state) return fail("state");
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, client_id: env.clientId, client_secret: env.clientSecret,
      redirect_uri: `${origin}/api/auth/callback/google`, code_verifier: String(flow.verifier),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const user = typeof tok?.id_token === "string" ? await userFromIdToken(tok.id_token, env.clientId, String(flow.nonce)) : null;
  const session = user && (await sessionToken(user));
  if (!session) return fail("token");
  const res = NextResponse.redirect(`${origin}${String(flow.cb)}`, 303);
  res.cookies.set(n.session, session, cookieOpts(origin, SESSION_MAX_AGE));
  res.cookies.set(n.flow, "", cookieOpts(origin, 0));
  return res;
}
