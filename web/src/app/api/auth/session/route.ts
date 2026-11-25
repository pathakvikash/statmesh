import { NextResponse } from "next/server";
import { authConfigured } from "@/lib/auth-core";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const u = await getUser();
  return NextResponse.json({ configured: authConfigured(), user: u && { name: u.name, email: u.email, image: u.image } }, { headers: { "cache-control": "private, no-store" } });
}
