// Plain-language explanation of a series, built only from catalog metadata (rule 7: no figures, nothing guessed).
import type { SeriesDetail } from "@/lib/client";
import { periodLabel } from "@/lib/format";

type Txt = string | null | undefined;
const t = (s: Txt) => (s && s.trim() ? s.trim() : undefined);

export type ExplainOpts = { sourceName?: Txt; geoText?: Txt; freqText?: Txt; unitText?: Txt; coverage?: Txt; periods?: number | null };

/** "This series measures <title> for <geo>, reported <freq> in <unit>. Published by <source>." Missing parts are omitted. */
export function explainSeries(d: Pick<SeriesDetail, "title">, o: ExplainOpts): { lead: string; facts: string[] } {
  const geo = t(o.geoText), freq = t(o.freqText), unit = t(o.unitText), src = t(o.sourceName), cov = t(o.coverage);
  const how = [freq && `reported ${freq.toLowerCase()}`, unit && `in ${unit}`].filter(Boolean).join(" ");
  const lead = `This series measures ${d.title}${geo ? ` for ${geo}` : ""}${how ? `, ${how}` : ""}.${src ? ` Published by ${src}.` : ""}`;
  const n = o.periods ?? 0;
  const facts = [cov && `Covers ${cov}`, n > 0 && `${n} ${n === 1 ? "period" : "periods"} stored`].filter((x): x is string => !!x);
  return { lead, facts };
}

export type Chip = { label: string; ask: string } | { label: string; href: string };

/** Question chips (open the assistant) and link chips (compare, similar series, source page). */
export function seriesQuestions(d: Pick<SeriesDetail, "title" | "source_id">, o: { canCompare: boolean; hasTrend: boolean; unitText?: Txt; sp?: Record<string, string | undefined> }): Chip[] {
  const unit = t(o.unitText);
  // Like TabLinks: keep the frequency and dimension choices.
  const keep = new URLSearchParams(Object.entries(o.sp ?? {}).filter(([k, v]) => v && (k === "freq" || k.startsWith("dim."))) as [string, string][]);
  keep.set("tab", "compare");
  return [
    ...(o.hasTrend ? [{ label: "How has it changed?", ask: "how has it changed over the stored periods" }] : []),
    ...(unit ? [{ label: `What does ${unit} mean here?`, ask: `what the unit "${unit}" means for this series` }] : []),
    { label: "What are the caveats?", ask: "what are the caveats and limitations of this series" },
    ...(o.canCompare ? [{ label: "Compare", href: `?${keep}` }] : []),
    { label: "Similar series", href: `/search?q=${encodeURIComponent(d.title.split(/\s+/).slice(0, 4).join(" "))}` },
    { label: "About the source", href: `/sources/${encodeURIComponent(d.source_id)}` },
  ];
}

/** Honest note under a chart that has very few stored points. */
export function sparseNote(pts: { t: string }[], freq: Txt, source: Txt): string {
  const n = pts.length;
  const a = periodLabel(pts[0]?.t, freq), b = periodLabel(pts[n - 1]?.t, freq);
  return `Only ${n} ${n === 1 ? "period" : "periods"} stored (${n > 1 && a !== b ? `${a}–${b}` : a}).${t(source) ? ` Source: ${t(source)}.` : ""}`;
}
