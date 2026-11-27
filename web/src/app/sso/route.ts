import { ssoTarget, verifyHandoff } from "@/lib/orrery-sso";

export const dynamic = "force-dynamic";

// GET /sso?token=<handoff jwt>&next=</path>: verify, then 302 to a same-origin relative path.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (!(await verifyHandoff(q.get("token")))) return new Response("Invalid or expired handoff token", { status: 401, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 302, headers: { Location: ssoTarget(q.get("next")), "Cache-Control": "no-store" } });
}
