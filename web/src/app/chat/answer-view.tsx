import { Markdown } from "@/components/ai/Markdown";
import { ChartCard, ChartSkeleton } from "@/components/chat-viz/chart-card";
import { collectEvidence } from "@/lib/chat/evidence";
import type { ChatEvent } from "@/lib/chat/events";
import { flagUnsourcedNumbers } from "@/lib/chat/flag";
import type { ChartData } from "@/lib/chat/chart";
import { autoChart } from "@/lib/chat/auto-chart";
import { attributionLine } from "@/lib/chat/details";
import { mergeTextRuns } from "@/lib/chat/text-runs";
import { groupLabel, groupToolCalls } from "@/lib/chat/tool-group";
import { collectSourceGroups } from "@/lib/chat/cited-sources";
import type { Citation } from "@/lib/format";
import { AnswerDetails } from "./answer-details";
import { SourcesPill } from "./sources-pill";

export const textOf = (ev: ChatEvent[]) => ev.flatMap((e) => (e.t === "text" ? [e.text] : [])).join("");

/** show_chart: skeleton while running, the chart once the result has series; a failure is shown briefly. */
function ChartPart({ input, result, pending }: { input: unknown; result: unknown; pending: boolean }) {
  const o = result as Partial<ChartData> | undefined;
  if (o && Array.isArray(o.series)) return <ChartCard data={o as ChartData} />;
  if (result === undefined && pending) return <ChartSkeleton n={(input as { series?: unknown[] } | null)?.series?.length ?? 0} />;
  return null;
}

/** The answer: text, the charts the model asked for, one sources pill and one Details disclosure. Tool rows, data, SQL and licences sit behind Details. */
export function Answer({ events, userText, busy, citations, unavailable = [] }: {
  events: ChatEvent[]; userText: string; busy?: boolean; citations?: Citation[]; unavailable?: string[];
}) {
  const ev = collectEvidence(events);
  const flagCount = flagUnsourcedNumbers(textOf(events), ev.results, userText).length;
  const results = new Map(events.flatMap((e) => (e.t === "result" ? [[e.id, e.output] as const] : [])));
  const group = groupToolCalls(events, !!busy);
  const sourceGroups = collectSourceGroups(events);
  const cites = citations ?? (ev.citations as Citation[]);
  const attribution = attributionLine(cites);
  const restricted = [...new Set(cites.filter((c) => c.redistribute && c.redistribute !== "yes").map((c) => c.redistribute))];
  const auto = busy ? null : autoChart(events);
  const hasText = !!textOf(events).trim();
  return (
    <section className="space-y-3 text-[15px] leading-relaxed">
      {mergeTextRuns(events).map((e, i) => {
        if (e.t === "text") return <Markdown key={i} text={e.text} results={ev.results} userText={userText} />;
        if (e.t === "error") return <p key={i} role="alert" className="text-destructive">Error: {e.message}</p>;
        if (e.t === "call" && e.name === "show_chart") return <div key={i}><ChartPart input={e.input} result={results.get(e.id)} pending={!!busy && !results.has(e.id)} /></div>;
        return null;
      })}
      {auto && <ChartCard data={auto} />}
      {busy && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span aria-hidden className="size-3 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent" />
          {hasText || !group.total ? "…" : groupLabel(group)}
        </p>
      )}
      {flagCount > 0 && (
        <p role="status" className="mt-2 rounded-lg border border-accent/40 bg-accent/10 p-2 text-sm text-foreground">
          {flagCount} number{flagCount > 1 ? "s" : ""} in this answer {flagCount > 1 ? "do" : "does"} not appear in any tool result. Treat as unverified.
        </p>
      )}
      {!busy && (
        <div className="mt-3 flex flex-wrap items-start gap-2 text-sm">
          <SourcesPill groups={sourceGroups} unavailable={unavailable} />
          <AnswerDetails group={group} busy={!!busy} sqls={ev.sqls} citations={cites} />
        </div>
      )}
      {!busy && (attribution || restricted.length > 0) && (
        <p className="text-xs text-muted-foreground">
          {attribution && <>Data: {attribution}. </>}
          {restricted.length > 0 && <strong className="font-medium text-foreground">Redistribution: {restricted.join(", ")}. </strong>}
          Licences are under Details.
        </p>
      )}
    </section>
  );
}
