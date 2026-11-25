"use client";
import { useEffect, useState } from "react";

type U = { name: string | null; email: string | null; image: string | null };

/** Asks /api/auth/session at runtime whether sign-in is configured (so pages stay static and runtime-only env works); renders nothing if not. */
export function AuthControl() {
  const [user, setUser] = useState<U | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json()).then((d) => setUser(d.configured ? (d.user ?? null) : undefined)).catch(() => setUser(undefined));
  }, []);
  if (user === undefined) return null; // loading, or sign-in not configured
  if (!user) {
    const cb = typeof location === "undefined" ? "/" : location.pathname + location.search;
    return (
      <a href={`/api/auth/signin/google?callbackUrl=${encodeURIComponent(cb)}`}
        className="flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted sm:min-h-0 sm:py-1.5">
        Sign in with Google
      </a>
    );
  }
  const label = user.name || user.email || "Account";
  return (
    <details className="relative">
      <summary aria-label={`Account menu for ${label}`} className="grid size-11 cursor-pointer list-none place-items-center sm:size-9 [&::-webkit-details-marker]:hidden">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full sm:size-7" />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-muted text-sm font-medium sm:size-7">{label[0]?.toUpperCase()}</span>
        )}
      </summary>
      <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-border bg-card p-2 text-sm shadow-lg">
        <div className="truncate px-2 py-1 font-medium">{label}</div>
        {user.email && user.email !== label && <div className="truncate px-2 pb-1 text-xs text-muted-foreground">{user.email}</div>}
        <form method="post" action="/api/auth/signout">
          <button type="submit" className="w-full rounded px-2 py-1.5 text-left hover:bg-muted">Sign out</button>
        </form>
      </div>
    </details>
  );
}
