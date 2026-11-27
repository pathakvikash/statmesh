// Orrery SSO handoff: a 60 s, single-use HS256 token (purpose "sso") signed with ORRERY_APP_SECRET.
// StatMesh browsing is anonymous, so a valid handoff only redirects to a same-origin path; there is
// no session to create. (Google sign-in stays optional and separate.)
import { jwtVerify } from "jose";
import { safeCallbackUrl } from "./auth-core";

const seen = new Map<string, number>(); // jti -> exp (s). ponytail: per-instance memory; a replay across serverless instances within 60 s is not caught. Use a shared store if that matters.

export async function verifyHandoff(token: string | null, env: Record<string, string | undefined> = process.env, now = Date.now()): Promise<boolean> {
  const secret = env.ORRERY_APP_SECRET;
  if (!secret || !token) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: env.ORRERY_ISSUER || "orrery",
      audience: env.ORRERY_APP_ID || "statmesh",
      clockTolerance: 30,
      currentDate: new Date(now),
    });
    if (payload.purpose !== "sso" || !payload.jti || typeof payload.exp !== "number" || typeof payload.iat !== "number") return false;
    if (payload.exp - payload.iat > 60) return false;
    for (const [k, e] of seen) if (e + 30 < now / 1000) seen.delete(k);
    if (seen.has(payload.jti)) return false;
    seen.set(payload.jti, payload.exp);
    return true;
  } catch {
    return false;
  }
}

export const ssoTarget = (next: string | null) => safeCallbackUrl(next);
