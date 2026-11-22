"use client";
import { useState } from "react";

/** Info icon: hover or focus shows the text, Escape hides it again. The text is also exposed via aria-describedby. */
export function InfoTip({ id, text }: { id: string; text: string }) {
  const [hidden, setHidden] = useState(false);
  return (
    <span className="group relative inline-flex" onMouseEnter={() => setHidden(false)} onFocus={() => setHidden(false)}>
      <button type="button" aria-describedby={id} aria-label="How this is calculated" onKeyDown={(e) => { if (e.key === "Escape") setHidden(true); }}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground">i</button>
      <span id={id} role="tooltip"
        className={`pointer-events-none absolute right-0 top-5 z-10 w-56 rounded-lg border border-border bg-card p-2 text-xs font-normal normal-case tracking-normal text-foreground opacity-0 shadow-sm ${hidden ? "" : "group-hover:opacity-100 group-focus-within:opacity-100"}`}>
        {text}
      </span>
    </span>
  );
}
