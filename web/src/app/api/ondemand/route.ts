import { triggerLive } from "@/lib/client";
import { isHosted } from "@/lib/mode";

// Same-origin trigger for one live fetch of a series (the compare picker calls it for curated exact ids).
export const dynamic = "force-dynamic";

/** A 3-part key: source:dataset:indicator, nothing else may reach the API. */
const KEY_RE = /^[a-z0-9_]+:[A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-$]+$/;
/** Live fetches in flight in this process. Each one can take up to 15 s on the API side. */
const MAX_LIVE = 4;
let liveInFlight = 0;

export async function POST(req: Request) {
  if (isHosted()) return Response.json({ detail: "On-demand loading is off on hosted instances." }, { status: 403 });
  let id: unknown;
  try {
    id = (await req.json())?.id;
  } catch {
    return Response.json({ detail: "Expected JSON with a series id." }, { status: 400 });
  }
  if (typeof id !== "string" || !KEY_RE.test(id)) return Response.json({ detail: "Not a 3-part series id." }, { status: 400 });
  // ponytail: a counter, not a queue; the picker retries nothing, so a busy server just answers 429.
  if (liveInFlight >= MAX_LIVE) {
    return Response.json({ detail: "Too many live fetches are running. Try again in a few seconds." }, { status: 429, headers: { "retry-after": "5" } });
  }
  liveInFlight++;
  try {
    return Response.json(await triggerLive(id, 15_000));
  } finally {
    liveInFlight--;
  }
}
