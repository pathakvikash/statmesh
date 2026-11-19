import Link from "next/link";
import { Citations } from "@/components/Citations";
import { ChartCard, ChartSkeleton } from "@/components/chat-viz/chart-card";
import { Table } from "@/components/Table";
import { collectEvidence } from "@/lib/chat/evidence";
import type { ChatEvent } from "@/lib/chat/events";
import { flagUnsourcedNumbers } from "@/lib/chat/flag";
import type { ChartData } from "@/lib/chat/chart";
import { formatPeriod, seriesHref, type Citation } from "@/lib/format";

export const textOf = (ev: ChatEvent[]) => ev.flatMap((e) => (e.t === "text" ? [e.text] : [])).join("");

/** show_chart: skeleton while running, chart once the server-side result arrives. */
function ChartPart({ input, result, busy }: { input: unknown; result: unknown; busy: boolean }) {
  const o = result as Partial<ChartData> | undefined;
  if ((o as { unavailable?: boolean } | undefined)?.unavailable) return <p className="my-2 rounded-xl border border-border p-3 text-muted-foreground">This chart is no longer available.</p>;
  if (o && Array.isArray(o.series)) return <ChartCard data={o as ChartData} />;
  if (o || !busy) return <p role="alert" className="my-2 rounded-xl border border-border p-3 text-destructive">Could not build the chart.</p>;
  const n = (input as { series?: unknown[] } | null)?.series?.length ?? 0;
  return <ChartSkeleton n={n} />;
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
      {events.map((e, i) =>
        e.t === "text" ? <Flagged key={i} text={e.text} results={ev.results} userText={userText} />
        : e.t === "error" ? <p key={i} role="alert" className="text-destructive">Error: {e.message}</p>
        : e.t === "call" && e.name === "show_chart" ? (
          <ChartPart key={i} input={e.input} result={data.find((d) => d.id === e.id)?.output} busy={!!busy} />
        )
        : e.t === "call" ? (
          <details key={i} className="my-1 text-muted-foreground">
            <summary className="cursor-pointer font-mono">tool: {e.name}</summary>
            <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs text-foreground">{JSON.stringify(e.input, null, 2)}</pre>
          </details>
        ) : null)}
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
