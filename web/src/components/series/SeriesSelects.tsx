"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type SelectSpec = { param: string; label: string; options: { value: string; label: string }[]; value: string };

/** One select per dimension and one for frequency. Each change rewrites only its own URL param, so links stay shareable. */
export function SeriesSelects({ selects }: { selects: SelectSpec[] }) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const [pending, start] = useTransition();
  if (!selects.length) return null;
  const set = (param: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(param, value);
    start(() => router.replace(`${path}?${next}`, { scroll: false }));
  };
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" aria-busy={pending || undefined}>
      {selects.map((s) => (
        <label key={s.param} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
          {s.label}
          <select value={s.value} onChange={(e) => set(s.param, e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent">
            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
