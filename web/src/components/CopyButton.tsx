"use client";
import { useState } from "react";
import { btn } from "@/lib/ui";

export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={`${btn} ${className}`} onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      } catch { /* clipboard blocked: nothing to do */ }
    }}>
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
