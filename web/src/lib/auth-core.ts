// Pure pieces of optional Google sign-in (no Next imports, unit-tested). Stateless: identity lives only in a signed cookie.
type Env = Record<string, string | undefined>;

export type User = { id: string; name: string | null; email: string | null; image: string | null };
export const SESSION_MAX_AGE = 30 * 24 * 3600;
export const SCOPES = "openid email profile";

/** `origin` is the configured public origin; null only in development with STATMESH_SITE_URL unset (callers then use the request's). */
export type AuthEnv = { secret: string; clientId: string; clientSecret: string; origin: string | null };

/** Public origin from STATMESH_SITE_URL: https always; http only for localhost, and only outside production. Else null. */
export function siteOrigin(env: Env = process.env): string | null {
  try {
    const u = new URL(env.STATMESH_SITE_URL?.trim() ?? "");
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return u.protocol === "https:" || (u.protocol === "http:" && local && env.NODE_ENV !== "production") ? u.origin : null;
  } catch {
    return null;
  }
}

/** Null (feature fully inert) unless all three are set; AUTH_SECRET must be >= 32 chars. In production STATMESH_SITE_URL must also be a valid https URL. */
export function authEnv(env: Env = process.env): AuthEnv | null {
  const secret = env.AUTH_SECRET?.trim(), clientId = env.AUTH_GOOGLE_ID?.trim(), clientSecret = env.AUTH_GOOGLE_SECRET?.trim();
  if (!secret || secret.length < 32 || !clientId || !clientSecret) return null;
  const origin = siteOrigin(env);
  if (!origin && (env.NODE_ENV === "production" || env.STATMESH_SITE_URL?.trim())) return null;
  return { secret, clientId, clientSecret, origin };
}
export const authConfigured = (env: Env = process.env) => authEnv(env) !== null;

/** Same-origin paths only: "/x?y#z". Rejects //host, /\host, absolute URLs, control chars. Fallback "/". */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return "/";
  try {
    const u = new URL(raw, "http://x.invalid");
    const out = u.pathname + u.search + u.hash;
    return u.origin === "http://x.invalid" && !u.pathname.startsWith("/api/auth") && !out.startsWith("//") ? out : "/";
  } catch {
    return "/";
  }
}

/** Google id_token claims -> User. Account key is `sub`; email is kept only when Google verified it. */
export function userFromClaims(c: Record<string, unknown>): User | null {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const id = s(c.sub);
  if (!id) return null;
  return { id, name: s(c.name), email: c.email_verified === true ? s(c.email) : null, image: s(c.picture) };
}

/** Claims stored in the session token: exactly sub, name, email, picture. */
export const toClaims = (u: User) => ({ sub: u.id, name: u.name, email: u.email, picture: u.image });

/** Free-assistant daily turns for a signed-in user (STATMESH_FREE_LIMIT_USER_DAY, default 100). */
export function freeLimitUserDay(env: Env = process.env): number {
  const v = Number(env.STATMESH_FREE_LIMIT_USER_DAY);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 100;
}

export function cookieName(secure: boolean, base: string) {
  return secure ? `__Host-${base}` : base;
}
