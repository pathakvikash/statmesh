"use client";
import { useRef } from "react";
import { pageSlice } from "@/lib/chat/details";

/** "1–5 of 12" with prev/next. Renders nothing when everything fits on one page. */
export function Pager({ total, page, onPage, size }: { total: number; page: number; onPage: (p: number) => void; size?: number }) {
  const s = pageSlice(total, page, size);
  const prev = useRef<HTMLButtonElement>(null), next = useRef<HTMLButtonElement>(null);
  if (s.pages <= 1) return null;
  // A button that disables itself while focused would drop keyboard focus: hand it to the other one.
  const go = (p: number, other: React.RefObject<HTMLButtonElement | null>) => { onPage(p); if (p === 0 || p >= s.pages - 1) other.current?.focus(); };
  const btn = "rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted disabled:opacity-40";
  return (
    <div className="mt-1 flex items-center justify-end gap-2 text-xs text-muted-foreground">
      <span aria-live="polite">{s.from}–{s.to} of {s.total}</span>
      <button ref={prev} type="button" className={btn} disabled={s.page === 0} onClick={() => go(s.page - 1, next)} aria-label="Previous page">Prev</button>
      <button ref={next} type="button" className={btn} disabled={s.page >= s.pages - 1} onClick={() => go(s.page + 1, prev)} aria-label="Next page">Next</button>
    </div>
  );
}
