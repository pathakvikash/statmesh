"use client";

import { askAbout, type AskTarget } from "@/lib/ask-about";
import { useAssistant } from "@/components/ai/AssistantProvider";

/** Opens the assistant sidebar as a new chat about a series or source. Props are plain data, so server components can render it. */
export function AskAiButton({ target, question, label = "Ask AI", className = "" }: {
  target: AskTarget; question?: string; label?: string; className?: string;
}) {
  const { ask } = useAssistant();
  return (
    <button type="button" aria-label={`Ask AI about ${target.kind === "series" ? target.title : target.name}`} aria-controls="assistant-panel" onClick={() => ask(askAbout(target, question))}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sm hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent justify-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 ${className}`}>
      <span aria-hidden>✦</span>{label}
    </button>
  );
}
