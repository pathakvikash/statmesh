// Pure logic for the collapsed tool line ("Searched 6 times · 3 sources"): counts, failures that a later
// call made good, and the deduped sources behind the numbers. Provenance only from tool inputs and results.
import type { ChatEvent } from "./events";
import { summarizeTool, type ToolStatus } from "./tool-summary";

export type GroupCall = { id: string; name: string; input: unknown; output: unknown; status: ToolStatus; muted: boolean };
export type SourceChip = { id: string; name: string; code: string; titles: string[] };
export type ToolGroup = { calls: GroupCall[]; total: number; running: number; failed: number; sources: SourceChip[] };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** Round-badge text: initials of a multi-word name (World Bank -> WB), else the short name itself, else 3 letters. */
export function shortCode(label: string): string {
  const words = label.split(/[\s_\-:/.]+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
  const w = words[0] ?? label;
  return (w.length <= 5 ? w : w.slice(0, 3)).toUpperCase();
}

/** Tool calls other than show_chart (charts stay visible on their own), grouped for one summary line. */
export function groupToolCalls(events: ChatEvent[], busy: boolean): ToolGroup {
  const results = new Map<string, unknown>();
  for (const e of events) if (e.t === "result") results.set(e.id, e.output);
  const raw = events.flatMap((e) => (e.t === "call" && e.name !== "show_chart" ? [e] : []));
  const calls: GroupCall[] = raw.map((c) => {
    const out = results.get(c.id);
    return { id: c.id, name: c.name, input: c.input, output: out, status: summarizeTool(c.name, c.input, out, busy && !results.has(c.id)).status, muted: false };
  });
  // A failure is muted when a later call to the same tool worked.
  calls.forEach((c, i) => {
    if (c.status === "failed") c.muted = calls.slice(i + 1).some((l) => l.name === c.name && (l.status === "ok" || l.status === "no_data"));
  });

  // Series the answer actually leaned on: those the model asked about or charted.
  const used = new Set<string>();
  for (const e of events) {
    if (e.t !== "call") continue;
    const i = rec(e.input);
    if (str(i?.series_id)) used.add(i!.series_id as string);
    if (Array.isArray(i?.series)) for (const s of i.series) if (str(rec(s)?.series_id)) used.add(rec(s)!.series_id as string);
  }
  const bySource = new Map<string, SourceChip>();
  const add = (id: string | undefined, name: string | undefined, title?: string) => {
    if (!id) return;
    const cur = bySource.get(id) ?? { id, name: name ?? id, code: shortCode(name ?? id), titles: [] };
    if (name && cur.name === id) Object.assign(cur, { name, code: shortCode(name) });
    if (title && !cur.titles.includes(title)) cur.titles.push(title);
    bySource.set(id, cur);
  };
  for (const c of calls) {
    const o = rec(c.output);
    if (!o || c.status === "failed") continue;
    if (Array.isArray(o.hits)) for (const h of o.hits) {
      const r = rec(h);
      if (r && used.has(r.series_id as string)) add(str(r.source_id), undefined, str(r.title));
    }
    for (const cit of [...(Array.isArray(o.citations) ? o.citations : []), o.citation]) {
      const r = rec(cit);
      if (r) add(str(r.source_id), str(r.source_name));
    }
    const sid = str(o.series_id);
    if (sid && str(o.title)) add(str(o.source_id), undefined, str(o.title));
  }
  return {
    calls,
    total: calls.length,
    running: calls.filter((c) => c.status === "running").length,
    failed: calls.filter((c) => c.status === "failed" && !c.muted).length,
    sources: [...bySource.values()],
  };
}

/** "Searched 6 times · 3 sources", or "Searching…" while a call is still running. */
export function groupLabel(g: ToolGroup): string {
  if (g.running) return g.total > 1 ? `Searching… (${g.total} so far)` : "Searching…";
  const parts = [`Searched ${g.total} ${g.total === 1 ? "time" : "times"}`];
  if (g.sources.length) parts.push(`${g.sources.length} ${g.sources.length === 1 ? "source" : "sources"}`);
  return parts.join(" · ");
}

/** At most `max` chips, then the count of the rest. */
export const visibleSources = (s: SourceChip[], max = 5) => ({ shown: s.slice(0, max), more: Math.max(0, s.length - max) });
