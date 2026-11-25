import { freeAvailable } from "@/lib/chat/free";

export const dynamic = "force-dynamic";

/** Whether the free shared assistant is configured and allowed. Booleans only: no keys, URLs or limits. */
export async function GET() {
  return Response.json({ available: freeAvailable() }, { headers: { "cache-control": "no-store" } });
}
