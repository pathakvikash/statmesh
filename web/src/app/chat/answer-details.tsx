"use client";
import Link from "next/link";
import { useState } from "react";
import { Citations } from "@/components/Citations";
import { sqlWorkbenchHref } from "@/lib/ai-context";
import { groupLabel, type ToolGroup } from "@/lib/chat/tool-group";
import type { Citation } from "@/lib/format";
import { ToolCallRow } from "./tool-call-row";

/** Everything behind the answer in one collapsed disclosure: tool calls and their data, SQL, citations and licences. */
export function AnswerDetails({ group, busy, sqls, citations }: { group: ToolGroup; busy: boolean; sqls: string[]; citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  if (!group.calls.length && !sqls.length && !citations.length) return null;
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>
        Details
      </button>
      {/* Always mounted, only hidden: the licence and attribution text stays in the DOM. */}
      {(
        <div hidden={!open} className="w-full basis-full space-y-3 rounded-xl border border-border bg-card p-3">
          {group.calls.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{groupLabel(group)}</p>
              {group.calls.map((c) => (
                <ToolCallRow key={c.id} name={c.name} input={c.input} output={c.output} pending={busy && c.output === undefined} muted={c.muted} />
              ))}
            </div>
          )}
          {sqls.map((s, i) => {
            const href = sqlWorkbenchHref(s);
            return (
              <div key={i}>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">SQL used</h3>
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-2 text-xs text-foreground">{s}</pre>
                {href && <Link href={href} className="mt-1 inline-block text-xs text-accent underline">Open in SQL workbench</Link>}
              </div>
            );
          })}
          <Citations items={citations} />
        </div>
      )}
    </>
  );
}
