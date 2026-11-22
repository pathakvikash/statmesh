// The claude CLI spends the user's plan: only a same-origin browser request to a loopback host may start it.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
export function localSameOrigin(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return false;
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  try {
    return new URL(req.headers.get("origin") ?? "").host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
