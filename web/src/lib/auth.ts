import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { authEnv, cookieName, SESSION_MAX_AGE, toClaims, userFromClaims, type User } from "./auth-core";

export { authConfigured, freeLimitUserDay, safeCallbackUrl, type User } from "./auth-core";

const key = (secret: string) => new TextEncoder().encode(secret);
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

/** Public origin: always the configured STATMESH_SITE_URL, never Host/X-Forwarded-Host. Only in development without it, the request's. */
export const originOf = (req: Request) => authEnv()?.origin ?? new URL(req.url).origin;
export const SESSION = "sm_session";
export const FLOW = "sm_oauth";
export const names = (origin: string) => ({ session: cookieName(origin.startsWith("https:"), SESSION), flow: cookieName(origin.startsWith("https:"), FLOW) });

/** The one session cookie name read and cleared for this origin (`__Host-` on https, no fallback). */
const sessionCookieName = (origin: string | null | undefined) => names(origin ?? "http://localhost").session;

export const cookieOpts = (origin: string, maxAge: number) =>
  ({ httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge }) as const;

/** Each token carries a purpose (`typ`) so a flow token can never act as a session, or the reverse. */
export type Purpose = "flow" | "session";

export async function signToken(payload: Record<string, unknown>, ttlSec: number, typ: Purpose): Promise<string | null> {
  const env = authEnv();
  if (!env) return null;
  return new SignJWT({ ...payload, typ }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${ttlSec}s`).sign(key(env.secret));
}

export async function verifyToken(token: string | undefined, typ: Purpose): Promise<Record<string, unknown> | null> {
  const env = authEnv();
  if (!env || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key(env.secret), { algorithms: ["HS256"] });
    return payload.typ === typ ? payload : null;
  } catch {
    return null;
  }
}

export const sessionToken = (u: User) => signToken(toClaims(u), SESSION_MAX_AGE, "session");

/** Verifies Google's id_token (signature, issuer, audience, nonce) and maps it to a User. */
export async function userFromIdToken(idToken: string, clientId: string, nonce: string): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(idToken, jwks, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId });
    return payload.nonce === nonce ? userFromClaims(payload) : null;
  } catch {
    return null;
  }
}

/** Current user from the session cookie, or null (also null when auth is not configured). */
export async function getUser(): Promise<User | null> {
  const env = authEnv();
  if (!env) return null;
  const jar = await cookies();
  return userOf(jar.get(sessionCookieName(env.origin))?.value);
}

async function userOf(token: string | undefined): Promise<User | null> {
  const p = await verifyToken(token, "session");
  return p ? userFromClaims({ ...p, email_verified: !!p.email }) : null;
}

/** For route handlers (e.g. the free-assistant quota): the session's user id, or null. */
export async function sessionUserId(req: Request): Promise<string | null> {
  const name = sessionCookieName(authEnv()?.origin);
  const v = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  return (await userOf(v))?.id ?? null;
}

export const isSignedIn = async (req: Request): Promise<boolean> => !!(await sessionUserId(req));
