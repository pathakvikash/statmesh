import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Lookup = (host: string) => Promise<{ address: string }[]>;
type Kind = "blocked" | "local" | "public";

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data"]);
// Cloud metadata addresses outside link-local: Alibaba, Oracle, AWS IPv6.
const METADATA_IPS = new Set(["100.100.100.200", "192.0.0.192", "fd00:ec2:0:0:0:0:0:254"]);

function v4Kind(o: number[]): Kind {
  const [a, b] = o;
  if (a === 0 || a >= 224) return "blocked"; // 0.0.0.0/8, multicast, reserved, broadcast
  if (a === 169 && b === 254) return "blocked"; // link-local (incl. 169.254.169.254)
  if (a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128)) return "local";
  return "public";
}

/** Expands an IPv6 literal to 8 hextets (handles `::` and a trailing dotted IPv4). */
function expand6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const p = m[1].split(".").map(Number);
    s = s.slice(0, -m[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  const parts = [...h, ...Array<string>(Math.max(fill, 0)).fill("0"), ...t].map((x) => parseInt(x, 16));
  return parts.length === 8 && parts.every((x) => x >= 0 && x <= 0xffff) ? parts : null;
}

/** blocked = never allowed; local = loopback/private (self-host only); public otherwise. */
export function classifyIp(ip: string): Kind {
  const v = isIP(ip);
  if (v === 4) return METADATA_IPS.has(ip) ? "blocked" : v4Kind(ip.split(".").map(Number));
  const g = v === 6 ? expand6(ip) : null;
  if (!g) return "blocked";
  if (METADATA_IPS.has(g.map((x) => x.toString(16)).join(":"))) return "blocked";
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // IPv4-mapped (::ffff:a.b.c.d) or compatible (::a.b.c.d); also :: and ::1
    if (g.slice(0, 7).every((x) => x === 0)) return g[7] === 1 ? "local" : "blocked";
    return v4Kind([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  }
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return "blocked"; // fe80::/10, multicast
  if ((g[0] & 0xfe00) === 0xfc00) return "local"; // fc00::/7
  return "public";
}

/**
 * Server-side check for a user-supplied model base URL, run after DNS resolution over every
 * address. Returns a generic error (never the address) or null. Loopback/private hosts are allowed
 * unless STATMESH_MODE is "hosted". ponytail: the later fetch resolves again (DNS rebinding window).
 */
export async function checkBaseUrl(
  baseUrl: string,
  opts: { hosted?: boolean; lookup?: Lookup } = {},
): Promise<string | null> {
  const hosted = opts.hosted ?? process.env.STATMESH_MODE === "hosted";
  const lookup = opts.lookup ?? ((h: string) => dnsLookup(h, { all: true }));
  const denied = "That base URL is not allowed.";
  let host: string;
  try {
    host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  } catch {
    return "Base URL is not a valid URL.";
  }
  if (METADATA_HOSTS.has(host)) return denied;
  let addrs: string[];
  try {
    addrs = isIP(host) ? [host] : (await lookup(host)).map((a) => a.address);
  } catch {
    return "Base URL host could not be resolved.";
  }
  if (!addrs.length) return "Base URL host could not be resolved.";
  for (const a of addrs) {
    const k = classifyIp(a);
    if (k === "blocked" || (k === "local" && hosted)) return denied;
  }
  return null;
}
