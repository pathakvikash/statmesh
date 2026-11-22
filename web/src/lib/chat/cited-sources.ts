// Pure logic for the sources pill under an answer: the series the answer used, grouped by source.
// Provenance comes only from tool inputs and results, never from model text.
import type { ChatEvent } from "./events";
import { shortCode } from "./tool-group";

export type CitedSeries = { id: string; title?: string };
export type SourceGroup = { id: string; name: string; code: string; color: string; series: CitedSeries[] };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Deterministic badge colour per source id; dark enough for white text in both themes. */
export function sourceColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 36%)`;
}

export const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s);

/** Series ids are "<source_id>:<dataset>:<series>", so the prefix names the source when no result does. */
const sourceOf = (seriesId: string) => seriesId.split(":")[0] || seriesId;

/** Used series (asked about, charted, described, observed or cited), deduped, grouped by source in first-seen order. */
export function collectSourceGroups(events: ChatEvent[]): SourceGroup[] {
  const used: string[] = [];
  const addUsed = (id: unknown) => { if (typeof id === "string" && id && !used.includes(id)) used.push(id); };
  const title = new Map<string, string>();
  const srcOfSeries = new Map<string, string>();
  const srcName = new Map<string, string>();
  const cite = (c: unknown) => {
    const r = rec(c);
    if (!r) return;
    const sid = str(r.source_id);
    if (sid && str(r.source_name)) srcName.set(sid, r.source_name as string);
    if (str(r.series_id)) { addUsed(r.series_id); if (sid) srcOfSeries.set(r.series_id as string, sid); }
  };
  for (const e of events) {
    if (e.t === "call") {
      const i = rec(e.input);
      addUsed(i?.series_id);
      if (Array.isArray(i?.series)) for (const s of i.series) addUsed(rec(s)?.series_id);
    } else if (e.t === "result") {
      const o = rec(e.output);
      if (!o) continue;
      const note = (h: Rec) => {
        const id = str(h.series_id);
        if (!id) return;
        if (str(h.title)) title.set(id, h.title as string);
        if (str(h.source_id)) srcOfSeries.set(id, h.source_id as string);
      };
      if (Array.isArray(o.hits)) for (const h of o.hits) { const r = rec(h); if (r) note(r); }
      if (e.name === "describe_series") { note(o); addUsed(o.series_id); }
      addUsed(o.series_id);
      for (const c of Array.isArray(o.citations) ? o.citations : []) cite(c);
      cite(o.citation);
    }
  }
  const groups = new Map<string, SourceGroup>();
  for (const id of used) {
    const sid = srcOfSeries.get(id) ?? sourceOf(id);
    let g = groups.get(sid);
    if (!g) {
      const name = srcName.get(sid) ?? sid;
      g = { id: sid, name, code: shortCode(name), color: sourceColor(sid), series: [] };
      groups.set(sid, g);
    }
    g.series.push({ id, title: title.get(id) });
  }
  return [...groups.values()];
}

/** What the collapsed pill shows: up to 3 icons, the first source's name, and how many other sources. */
export function pillSummary(groups: SourceGroup[]) {
  return { icons: groups.slice(0, 3), first: groups[0]?.name ?? "", more: Math.max(0, groups.length - 1), seriesCount: groups.reduce((n, g) => n + g.series.length, 0) };
}
