"use client";
import { useState } from "react";
import { PagedTable } from "@/components/ai/PagedTable";
import { tabulate } from "@/lib/chat/details";
import { summarizeTool, type ToolStatus } from "@/lib/chat/tool-summary";

const LIMIT = 2000;

const CHIP: Record<ToolStatus, { label: string; cls: string }> = {
  running: { label: "running", cls: "text-muted-foreground" },
  ok: { label: "ok", cls: "text-foreground" },
  no_data: { label: "no data", cls: "text-muted-foreground" },
  failed: { label: "failed", cls: "border-destructive text-destructive" },
};

function Chip({ status }: { status: ToolStatus }) {
  const c = CHIP[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs ${c.cls}`}>
      {status === "running" ? <span aria-hidden className="size-2.5 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent" /> : null}
      {c.label}
    </span>
  );
}

/** One tool call, collapsed to a line (status, name, key arguments, outcome); expands to a paged table of its result. */
export function ToolCallRow({ name, input, output, pending, muted = false }: { name: string; input: unknown; output: unknown; pending: boolean; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const s = summarizeTool(name, input, output, pending);
  const table = output === undefined ? null : tabulate(output);
  const json = !table && output !== undefined ? (JSON.stringify(output, null, 2) ?? "") : "";
  return (
    <div className={`my-1 rounded-xl border ${s.status === "failed" ? "border-destructive/60" : "border-border"} text-sm ${muted ? "opacity-60" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-muted/60">
        <Chip status={s.status} />
        <span className="shrink-0 font-mono">{name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.args}>{s.args}</span>
        <span title={s.outcome} className={`min-w-0 max-w-[45%] truncate text-right ${s.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{muted ? "retried, " : ""}{s.outcome}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {s.status === "failed" && <p role="note" className="whitespace-pre-wrap break-words text-destructive">{s.outcome}</p>}
          {table && <PagedTable columns={table.columns} rows={table.rows} caption={`${name} result`} />}
          {json && (
            <div>
              <button type="button" onClick={() => setRaw((r) => !r)} aria-expanded={raw} className="text-xs text-accent underline">{raw ? "Hide raw result" : "Show raw result"}</button>
              {raw && <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-muted p-2 text-xs">{json.length > LIMIT ? `${json.slice(0, LIMIT)}\n…` : json}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
