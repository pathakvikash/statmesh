"use client";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import {
  checkIds, isExact, MAX_SERIES, pickSuggestions, planLive, suggestionsFor,
  type Companion, type Concept, type Exact, type Hit, type Picked,
} from "@/lib/compare";
import { isMultiGeoKey } from "@/lib/multigeo";
import { sqlLiteral } from "@/lib/sql";

/** Same search route as the ⌘K palette. */
async function search(q: string): Promise<Hit[]> {
  try {
    const r = await fetch(`/api/palette?q=${encodeURIComponent(q)}`);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

/** One batched read: which of these 3-part ids have values. */
async function loadedIds(ids: string[]): Promise<Set<string>> {
  const ok = new Set<string>();
  if (!ids.length) return ok;
  const text = ids
    .map((id) => `SELECT ${sqlLiteral(id)} AS id WHERE EXISTS (SELECT 1 FROM observations WHERE starts_with(series_id, ${sqlLiteral(`${id}:`)}) AND value IS NOT NULL)`)
    .join(" UNION ALL ");
  try {
    const r = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: text }),
    });
    const j = await r.json();
    if (r.ok && Array.isArray(j.rows)) {
      for (const row of j.rows) {
        const id = Array.isArray(row) ? row[0] : row?.id;
        if (typeof id === "string") ok.add(id);
      }
    }
  } catch {
    // unknown rows: nothing is offered
  }
  return ok;
}

/** Asks the server to fetch one series from its source (it answers within 15 s). True when rows came back. */
async function fetchLive(id: string): Promise<boolean> {
  try {
    const r = await fetch("/api/ondemand", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.loaded === true;
  } catch {
    return false;
  }
}

/** What the picker shows for one source series. `done` once every stage has finished. */
type View = { items: Picked[]; fetching: Exact[]; notes: Companion[]; done: boolean };
/** Finished suggestions per source series, kept for the page session so reopening the picker is instant. */
const suggestionCache = new Map<string, View>();

/**
 * Resolves the suggestions for one series in stages: searches (one per concept), one batched row check
 * (exact ids and two hits per concept), then at most 3 live fetches, one at a time. `emit` runs after each stage.
 */
async function resolveSuggestions(selfId: string, title: string, emit: (v: View) => void, alive: () => boolean): Promise<View> {
  const companions = suggestionsFor(title);
  const exclude = [selfId];
  const hits = new Map<Companion, Hit[]>();
  await Promise.all(companions.filter((c): c is Concept => !isExact(c)).map(async (c) => {
    hits.set(c, await search(c.query));
  }));
  const rows = await loadedIds(checkIds(companions, hits, exclude));
  let view: View = { items: pickSuggestions(companions, hits, rows, exclude), fetching: [], notes: [], done: false };
  emit(view);
  for (const id of planLive(companions, rows, exclude)) {
    if (!alive()) return view;
    emit({ ...view, fetching: companions.filter((c): c is Exact => isExact(c) && c.id === id) });
    if (await fetchLive(id)) rows.add(id);
    view = { items: pickSuggestions(companions, hits, rows, exclude), fetching: [], notes: [], done: false };
    emit(view);
  }
  // Companions that carry a plain-language note but have no data loaded: say so, do not offer them.
  const notes = companions.filter((c) => !isExact(c) && c.note && !view.items.some((p) => p.companion === c));
  view = { items: view.items, fetching: [], notes, done: true };
  emit(view);
  return view;
}

const groupCls = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground";
const itemCls = "cursor-pointer rounded-lg px-3 py-2 data-[selected=true]:bg-muted data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40";

/** "Compare with...": suggested companions (resolved and checked for data) and a search over every series. */
export function ComparePicker({ open, onOpenChange, selfId, title, selected, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; selfId: string; title: string; selected: string[]; onPick: (id: string) => void;
}) {
  const full = selected.length >= MAX_SERIES;
  const skip = [selfId, ...selected];
  const [view, setView] = useState<{ key: string; v: View } | undefined>();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ term: string; list: Hit[] }>({ term: "", list: [] });

  useEffect(() => {
    if (!open || suggestionCache.has(selfId)) return;
    let alive = true;
    resolveSuggestions(selfId, title, (v) => { if (alive) setView({ key: selfId, v }); }, () => alive)
      .then((v) => { if (v.done) suggestionCache.set(selfId, v); });
    return () => { alive = false; };
  }, [open, selfId, title]);

  const term = q.trim();
  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const list = (await search(term)).filter((h) => isMultiGeoKey(h.id));
      if (live) setHits({ term, list });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [term]);

  const v = view?.key === selfId ? view.v : suggestionCache.get(selfId);
  const items = (v?.items ?? []).filter((p) => !selected.includes(p.hit.id));
  const fetching = v?.fetching ?? [];
  const done = v?.done ?? false;
  const notes = done ? v?.notes ?? [] : [];
  const searching = !v || (!done && items.length === 0 && fetching.length === 0);
  const searchingAll = term.length >= 2 && hits.term !== term;
  const shown = term.length >= 2 && !searchingAll ? hits.list.filter((h) => !skip.includes(h.id)) : [];
  const close = (o: boolean) => { if (!o) setQ(""); onOpenChange(o); };
  const pick = (id: string) => { if (!full) onPick(id); };

  return (
    <Command.Dialog open={open} onOpenChange={close} label="Compare with" shouldFilter={false}
      overlayClassName="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[15vh] z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      <Command.Input value={q} onValueChange={setQ} placeholder="Search all series to compare…"
        className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none placeholder:text-muted-foreground" />
      <Command.List className="max-h-96 overflow-y-auto p-2 text-sm">
        {full && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Limit of {MAX_SERIES} compared series. Remove one to add another.</p>}

        <Command.Group heading="Suggested" className={groupCls}>
          {searching && <p className="px-3 py-2 text-muted-foreground">Looking for related series…</p>}
          {items.map(({ companion, hit }) => (
            <Command.Item key={`suggest-${hit.id}`} value={`suggest ${hit.id}`} disabled={full} onSelect={() => pick(hit.id)} className={itemCls}>
              {companion.label !== hit.title && <div className="text-xs font-medium text-muted-foreground">{companion.label}</div>}
              <div className="truncate font-medium">{hit.title}</div>
              <div className="truncate text-xs text-muted-foreground">{hit.meta}</div>
              {companion.note && <div className="mt-1 text-xs text-muted-foreground">{companion.note}</div>}
            </Command.Item>
          ))}
          {fetching.map((c) => (
            <p key={`fetch-${c.id}`} role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <span aria-hidden className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {c.label}: Fetching live…
            </p>
          ))}
          {notes.map((c) => (
            <p key={`note-${c.label}`} role="note" className="px-3 py-2 text-xs text-muted-foreground">
              {c.note} No {c.label.toLowerCase()} data is loaded here, so it is not offered.
            </p>
          ))}
          {done && items.length === 0 && fetching.length === 0 && notes.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">No related series with data is loaded for this one.</p>
          )}
        </Command.Group>

        {term.length < 2 && <p className="px-3 py-2 text-xs text-muted-foreground">Type two or more letters to search every series.</p>}
        {term.length >= 2 && (
          <Command.Group heading="Search all" className={groupCls}>
            {searchingAll && <p role="status" className="px-3 py-2 text-muted-foreground">Searching…</p>}
            {!searchingAll && shown.length === 0 && <p role="status" className="px-3 py-2 text-muted-foreground">No series found.</p>}
            {shown.map((h) => (
              <Command.Item key={`all-${h.id}`} value={`all ${h.id}`} disabled={full} onSelect={() => pick(h.id)} className={itemCls}>
                <div className="truncate font-medium">{h.title}</div>
                <div className="truncate text-xs text-muted-foreground">{h.meta}</div>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
