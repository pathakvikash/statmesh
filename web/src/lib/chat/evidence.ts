import type { Citation } from "@/lib/format";
import type { ChatEvent } from "./events";

export type SeriesMeta = { id: string; title?: string; unit?: string | null; start?: string | null; end?: string | null };
export type Evidence = {
  /** Series ids seen in tool inputs and results, in first-seen order. */
  seriesIds: string[];
  meta: Map<string, SeriesMeta>;
  sqls: string[];
  citations: Citation[];
  /** Raw tool outputs: the corpus for flagUnsourcedNumbers. */
  results: unknown[];
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Everything the UI shows as provenance comes from here, i.e. from tool calls and results, never from model text. */
export function collectEvidence(events: ChatEvent[]): Evidence {
  const ev: Evidence = { seriesIds: [], meta: new Map(), sqls: [], citations: [], results: [] };
  const seenCit = new Set<string>();
  const addId = (id: unknown) => {
    if (typeof id === "string" && !ev.seriesIds.includes(id)) ev.seriesIds.push(id);
  };
  const addMeta = (h: Rec) => {
    const id = str(h.series_id);
    if (!id) return;
    addId(id);
    ev.meta.set(id, { id, title: str(h.title), unit: str(h.unit) ?? null, start: str(h.start) ?? null, end: str(h.end) ?? null });
  };
  for (const e of events) {
    if (e.t === "call") {
      const i = rec(e.input);
      addId(i?.series_id);
      if (e.name === "run_sql" && str(i?.sql) && !ev.sqls.includes(i!.sql as string)) ev.sqls.push(i!.sql as string);
    } else if (e.t === "result") {
      ev.results.push(e.output);
      const o = rec(e.output);
      if (!o) continue;
      if (Array.isArray(o.hits)) for (const h of o.hits) rec(h) && addMeta(rec(h)!);
      if (e.name === "describe_series") addMeta(o);
      addId(o.series_id);
      if (Array.isArray(o.citations))
        for (const c of o.citations as Citation[]) {
          addId(c.series_id);
          const k = `${c.source_id}|${c.dataset_id}|${c.series_id ?? ""}`;
          if (!seenCit.has(k)) (seenCit.add(k), ev.citations.push(c));
        }
      if (rec(o.citation)) {
        const c = o.citation as unknown as Citation;
        const k = `${c.source_id}|${c.dataset_id}|${c.series_id ?? ""}`;
        if (!seenCit.has(k)) (seenCit.add(k), ev.citations.push(c));
      }
    }
  }
  return ev;
}
