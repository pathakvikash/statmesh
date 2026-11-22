"use client";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { cleanQuestion } from "@/lib/chat/ask";

/** Secondary button of SearchForm: opens the assistant as a new chat and sends the input text. Never submits the form. */
export function AskButton({ className }: { className: string }) {
  const { ask } = useAssistant();
  const ref = useRef<HTMLButtonElement>(null);
  const [empty, setEmpty] = useState(true); // disabled until hydrated: without JS it can do nothing
  useEffect(() => {
    const input = ref.current?.form?.elements.namedItem("q") as HTMLInputElement | null;
    if (!input) return;
    const sync = () => setEmpty(!cleanQuestion(input.value));
    sync();
    input.addEventListener("input", sync);
    return () => input.removeEventListener("input", sync);
  }, []);
  const go = () => {
    const input = ref.current?.form?.elements.namedItem("q") as HTMLInputElement | null;
    const q = cleanQuestion(input?.value);
    if (q) ask(q);
  };
  return (
    <button ref={ref} type="button" disabled={empty} onClick={go} aria-controls="assistant-panel"
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
      Ask
    </button>
  );
}
