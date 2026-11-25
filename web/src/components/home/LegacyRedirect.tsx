"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { legacyTarget } from "./legacy";

/** Old links (/?q=, /?source=) keep working: the page itself is static (ISR), so this redirect runs in the browser. */
export function LegacyRedirect() {
  const router = useRouter();
  const sp = useSearchParams();
  const to = legacyTarget(sp);
  useEffect(() => { if (to) router.replace(to); }, [to, router]);
  return null;
}
