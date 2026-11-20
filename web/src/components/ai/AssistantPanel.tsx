"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChatPanel } from "./ChatPanel";

/** Right-hand slide-over: the same ChatPanel as /chat, in compact mode. Stays mounted while closed, so the conversation survives. */
export function AssistantPanel({ open, hosted, onClose }: { open: boolean; hosted: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [session, setSession] = useState(0);
  return (
    <aside id="assistant-panel" role="complementary" aria-label="AI assistant" hidden={!open}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-xl sm:w-[400px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Assistant</h2>
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => setSession((s) => s + 1)} className="text-muted-foreground hover:text-foreground">Clear</button>
          <button type="button" onClick={onClose} aria-label="Close assistant"
            className="grid size-7 place-items-center rounded-md text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground">&times;</button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <ChatPanel key={session} compact hosted={hosted} page={{ pathname, search }} />
      </div>
    </aside>
  );
}
