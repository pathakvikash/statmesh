import Link from "next/link";
import { Citations } from "@/components/Citations";
import { ChartCard, ChartSkeleton } from "@/components/chat-viz/chart-card";
import { Table } from "@/components/Table";
import { collectEvidence } from "@/lib/chat/evidence";
import type { ChatEvent } from "@/lib/chat/events";
import { flagUnsourcedNumbers } from "@/lib/chat/flag";
import type { ChartData } from "@/lib/chat/chart";
import { mergeTextRuns } from "@/lib/chat/text-runs";
import { formatPeriod, seriesHref, type Citation } from "@/lib/format";
import { ToolCallRow } from "./tool-call-row";

export const textOf = (ev: ChatEvent[]) => ev.flatMap((e) => (e.t === "text" ? [e.text] : [])).join("");

/** show_chart: skeleton while running, chart once the result has series. Anything else is a tool row with its reason. */
function CallPart({ name, input, result, pending }: { name: string; input: unknown; result: unknown; pending: boolean }) {
  if (name === "show_chart") {
    const o = result as Partial<ChartData> | undefined;
    if (o && Array.isArray(o.series)) return <ChartCard data={o as ChartData} />;
    if (result === undefined && pending) return <ChartSkeleton n={(input as { series?: unknown[] } | null)?.series?.length ?? 0} />;
  }
  return <ToolCallRow name={name} input={input} output={result} pending={pending} />;
}

/** Text with unsourced numbers wrapped in <mark>. */
function Flagged({ text, results, userText }: { text: string; results: unknown[]; userText: string }) {
  const flags = flagUnsourcedNumbers(text, results, userText);
  const out: React.ReactNode[] = [];
  let at = 0;
  flags.forEach((f, i) => {
    out.push(text.slice(at, f.start));
    out.push(<mark key={i} className="rounded bg-accent/25 px-0.5 text-foreground underline decoration-accent decoration-dotted" title="Not found in any tool result">{f.raw}</mark>);
    at = f.end;
  });
  out.push(text.slice(at));
  return <p className="whitespace-pre-wrap">{out}</p>;
}

/** `citations` and `unavailable` come from the server for a shared answer; a live answer derives its own. */
export function Answer({ events, userText, busy, citations, unavailable = [] }: {
  events: ChatEvent[]; userText: string; busy?: boolean; citations?: Citation[]; unavailable?: string[];
}) {
  const ev = collectEvidence(events);
  const flagCount = flagUnsourcedNumbers(textOf(events), ev.results, userText).length;
  const data = events.filter((e): e is Extract<ChatEvent, { t: "result" }> => e.t === "result");
  return (
    <section className="space-y-3 text-[15px] leading-relaxed">
      {mergeTextRuns(events).map((e, i) => {
        if (e.t === "text") return <Flagged key={i} text={e.text} results={ev.results} userText={userText} />;
        if (e.t === "error") return <p key={i} role="alert" className="text-destructive">Error: {e.message}</p>;
        if (e.t === "call") {
          const r = data.find((d) => d.id === e.id);
          return <CallPart key={i} name={e.name} input={e.input} result={r?.output} pending={!!busy && !r} />;
        }
        return null;
      })}
      {busy && <p className="text-muted-foreground">…</p>}
      {flagCount > 0 && (
        <p role="status" className="mt-2 rounded-lg border border-accent/40 bg-accent/10 p-2 text-sm text-foreground">
          {flagCount} number{flagCount > 1 ? "s" : ""} in this answer {flagCount > 1 ? "do" : "does"} not appear in any tool result. Treat as unverified.
        </p>
      )}
      {(ev.seriesIds.length > 0 || ev.sqls.length > 0) && (
        <div className="mt-3 border-t border-border pt-2">
          {ev.seriesIds.length > 0 && (
            <>
              <h3 className="font-semibold">Series used</h3>
              <ul className="list-disc pl-5">
                {ev.seriesIds.map((id) => {
                  const m = ev.meta.get(id);
                  return (
                    <li key={id}>
                      {unavailable.includes(id)
                        ? <><span className="font-mono">{id}</span> <em>no longer available</em></>
                        : <Link href={seriesHref(id)} className="font-mono text-accent underline">{id}</Link>}
                      {m && !unavailable.includes(id) && <> {m.title ? `${m.title}, ` : ""}unit {m.unit ?? "n/a"}, period {formatPeriod(m.start, m.end)}</>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {ev.sqls.map((s, i) => (
            <div key={i}>
              <h3 className="mt-2 font-semibold">SQL used</h3>
              <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs text-foreground">{s}</pre>
            </div>
          ))}
        </div>
      )}
      {data.map((d, i) => {
        const o = d.output as { columns?: string[]; rows?: unknown[][]; truncated?: boolean; warning?: string } | null;
        return o?.columns && o.rows ? (
          <div key={i} className="mt-3">
            <Table columns={o.columns} rows={o.rows} caption={`${d.name} result${o.truncated ? " (truncated)" : ""}`} />
            {o.warning && <p className="text-muted-foreground">{o.warning}</p>}
          </div>
        ) : null;
      })}
      <Citations items={citations ?? (ev.citations as Citation[])} />
    </section>
  );
}
