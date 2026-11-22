import Link from "next/link";
import { AskAiButton } from "@/components/AskAiButton";
import type { SeriesDetail } from "@/lib/client";
import { explainSeries, seriesQuestions, type ExplainOpts } from "@/lib/series-explain";
import { chip } from "@/lib/ui";

/** Header block: what the series is in plain words, the catalog description verbatim, and one-click questions. */
export function SeriesExplainer({ d, o, canCompare, hasTrend, sp }: { sp?: Record<string, string | undefined>; d: SeriesDetail; o: ExplainOpts; canCompare: boolean; hasTrend: boolean }) {
  const { lead, facts } = explainSeries(d, o);
  const target = { kind: "series" as const, id: d.series_id, title: d.title, source: d.source_id };
  return (
    <div className="max-w-3xl space-y-2">
      <p className="text-base">{lead}</p>
      {d.description && <p className="text-muted-foreground">{d.description}</p>}
      {facts.length > 0 && <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>}
      <div role="group" className="flex flex-wrap items-center gap-2 pt-1" aria-label="Questions and shortcuts">
        <AskAiButton target={target} label="Ask AI about this series" />
        {seriesQuestions(d, { canCompare, hasTrend, unitText: o.unitText, sp }).map((c) =>
          "ask" in c ? <AskAiButton key={c.label} target={target} question={c.ask} label={c.label} />
            : <Link key={c.label} href={c.href} className={`${chip} !px-2.5 !py-1 !text-xs font-medium`}>{c.label}</Link>)}
      </div>
    </div>
  );
}
