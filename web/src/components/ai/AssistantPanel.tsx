"use client";
import { useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChatPanel } from "./ChatPanel";
import { clampWidth, DEFAULT_W, keyWidth, maxWidth, MIN_W, type Mode } from "./assistant-width";

const ICON = "size-4";
const svg = { "aria-hidden": true, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const BTN = "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/** Right-hand panel: the same ChatPanel as /chat, in compact mode. Stays mounted while closed or collapsed, so the conversation survives. */
export function AssistantPanel({ mode, width, vw, wide, dragging, hosted, session, question, onClose, onCollapse, onOpen, onResize, onDragging, onToggleWide, onClear }: {
  mode: Mode; width: number; vw: number; wide: boolean; dragging: boolean; hosted: boolean; session: number; question?: string;
  onClose: () => void; onCollapse: () => void; onOpen: () => void;
  onResize: (w: number, final: boolean) => void; onDragging: (d: boolean) => void; onToggleWide: () => void; onClear: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const drag = useRef(false);
  const open = mode === "open";
  const max = maxWidth(vw);
  const at = (e: React.PointerEvent) => clampWidth(window.innerWidth - e.clientX, window.innerWidth);
  return (
    <>
      <aside id="assistant-panel" role="complementary" aria-label="AI assistant" hidden={!open}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        style={{ "--panel-w": `${width}px` } as React.CSSProperties}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-xl sm:w-[var(--panel-w)]">
        <div role="separator" aria-orientation="vertical" aria-label="Resize assistant" tabIndex={0}
          aria-valuenow={width} aria-valuemin={MIN_W} aria-valuemax={max}
          className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-ring/40 focus-visible:bg-ring/60 focus-visible:outline-none data-[dragging]:bg-ring/60 sm:block"
          data-dragging={dragging || undefined}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = true; onDragging(true);
          }}
          onPointerMove={(e) => { if (drag.current) onResize(at(e), false); }}
          onPointerUp={(e) => { if (!drag.current) return; drag.current = false; onDragging(false); onResize(at(e), true); }}
          onPointerCancel={() => { drag.current = false; onDragging(false); }}
          onDoubleClick={() => onResize(DEFAULT_W, true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); return onResize(DEFAULT_W, true); }
            const w = keyWidth(e.key, e.shiftKey, width, window.innerWidth);
            if (w !== null) { e.preventDefault(); onResize(w, true); }
          }} />
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Assistant</h2>
          <div className="flex items-center gap-2 text-sm">
            <button type="button" onClick={onClear} className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">Clear</button>
            <button type="button" onClick={onToggleWide} aria-pressed={wide} aria-label={wide ? "Shrink assistant" : "Enlarge assistant"}
              title={wide ? "Shrink assistant" : "Enlarge assistant"} className={`${BTN} hidden sm:grid`}>
              <svg {...svg} className={ICON}>{wide ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}</svg>
            </button>
            <button type="button" onClick={onCollapse} aria-label="Collapse assistant to side rail" title="Collapse to rail" className={`${BTN} hidden sm:grid`}>
              <svg {...svg} className={ICON}><path d="M9 6l6 6-6 6" /></svg>
            </button>
            <button type="button" onClick={onClose} aria-label="Close assistant" className={`${BTN} text-lg leading-none`}>&times;</button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <ChatPanel key={session} compact hosted={hosted} question={question} page={{ pathname, search }} />
        </div>
      </aside>
      {mode === "rail" && (
        <div className="fixed inset-y-0 right-0 z-40 hidden w-11 flex-col items-center border-l border-border bg-background pt-3 sm:flex">
          <button type="button" id="assistant-rail-open" onClick={onOpen} aria-label="Open assistant" aria-controls="assistant-panel" aria-expanded={false}
            title="Open assistant (Ctrl/⌘ J)" className={BTN}>
            <svg {...svg} className={ICON}><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <span aria-hidden className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground [writing-mode:vertical-rl]">Assistant</span>
        </div>
      )}
    </>
  );
}
