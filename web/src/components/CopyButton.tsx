"use client";
import { useRef, useState } from "react";
import { btn } from "@/lib/ui";

export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(""), 1600); };
  return (
    <>
      <button type="button" className={`${btn} ${className}`} onClick={async () => {
        try { await navigator.clipboard.writeText(text); setManual(false); say("Copied"); }
        catch { setManual(true); say("Copy blocked: text selected, press Ctrl+C"); }
      }}>
        {msg === "Copied" ? "Copied" : label}
      </button>
      {/* Clipboard rejected: show the text selected so the user can copy it by hand. */}
      {manual && <input readOnly aria-label={`${label}: text to copy`} value={text} autoFocus onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setManual(false)} className="min-w-0 max-w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-xs" />}
      <span role="status" aria-live="polite" className="sr-only">{msg}</span>
    </>
  );
}
