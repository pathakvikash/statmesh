import { NextResponse } from "next/server";
import { cookieOpts, names, originOf } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST only, same-origin only (Origin header must match), so a third-party page cannot sign users out. */
export async function POST(req: Request) {
  const origin = originOf(req);
  const from = req.headers.get("origin");
  if (from && from !== origin) return new NextResponse(null, { status: 403 });
  const res = NextResponse.redirect(`${origin}/`, 303);
  res.cookies.set(names(origin).session, "", cookieOpts(origin, 0));
  return res;
}
