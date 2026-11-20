"use client";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { MAX_SERIES, resolveCompanion, suggestionsFor, type Companion } from "@/lib/compare";
import { isMultiGeoKey } from "@/lib/multigeo";
import { sqlLiteral } from "@/lib/sql";

type Hit = { id: string; title: string; meta: string };
/** A suggestion with its loaded series, or null when nothing with data is loaded for it. */
type Resolved = { companion: Companion; hit: Hit | null };

/** Same search route as the ⌘K palette. */
async function search(q: string): Promise<Hit[]> {
  try {
    const r = await fetch(`/api/palette?q=${encodeURIComponent(q)}`);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

/** A suggestion must be a real series with values, not only a catalogue entry. */
async function hasObservations(id: string): Promise<boolean> {
  try {
    const r = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: `SELECT 1 AS ok FROM observations WHERE starts_with(series_id, ${sqlLiteral(`${id}:`)}) AND value IS NOT NULL LIMIT 1` }),
    });
    const j = await r.json();
    return r.ok && Array.isArray(j.rows) && j.rows.length > 0;
  } catch {
    return false;
  }
}

const groupCls = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground";
const itemCls = "cursor-pointer rounded-lg px-3 py-2 data-[selected=true]:bg-muted data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-40";

/** "Compare with...": suggested companions (resolved and checked for data) and a search over every series. */
export function ComparePicker({ open, onOpenChange, selfId, title, selected, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; selfId: string; title: string; selected: string[]; onPick: (id: string) => void;
}) {
  const full = selected.length >= MAX_SERIES;
  const selectedKey = selected.join(",");
  const skip = [selfId, ...selected];
  const [found, setFound] = useState<{ key: string; items: Resolved[] } | undefined>();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ term: string; list: Hit[] }>({ term: "", list: [] });
  const stateKey = `${selfId}|${title}|${selectedKey}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    const skipIds = [selfId, ...selectedKey.split(",").filter(Boolean)];
    Promise.all(suggestionsFor(title).map(async (c): Promise<Resolved> => ({
      companion: c, hit: (await resolveCompanion(c, await search(c.query), skipIds, hasObservations)) ?? null,
    }))).then((items) => {
      if (live) setFound({ key: stateKey, items });
    });
    return () => { live = false; };
  }, [open, stateKey, selfId, selectedKey, title]);

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

  const ready = found?.key === stateKey;
  const items = ready ? found.items.filter((r): r is Resolved & { hit: Hit } => r.hit !== null) : [];
  // Companions that carry a plain-language note but have no data loaded: say so, do not offer them.
  const unloaded = ready ? found.items.filter((r) => r.hit === null && r.companion.note) : [];
  const searching = term.length >= 2 && hits.term !== term;
  const shown = term.length >= 2 && !searching ? hits.list.filter((h) => !skip.includes(h.id)) : [];
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
          {!ready && <p className="px-3 py-2 text-muted-foreground">Looking for related series…</p>}
          {ready && items.length === 0 && unloaded.length === 0 && <p className="px-3 py-2 text-muted-foreground">No related series with data is loaded for this one.</p>}
          {unloaded.map(({ companion }) => (
            <p key={`note-${companion.label}`} role="note" className="px-3 py-2 text-xs text-muted-foreground">
              {companion.note} No {companion.label.toLowerCase()} data is loaded here, so it is not offered.
            </p>
          ))}
          {items.map(({ companion, hit }) => (
            <Command.Item key={`suggest-${hit.id}`} value={`suggest ${hit.id}`} disabled={full} onSelect={() => pick(hit.id)} className={itemCls}>
              <div className="text-xs font-medium text-muted-foreground">{companion.label}</div>
              <div className="truncate font-medium">{hit.title}</div>
              <div className="truncate text-xs text-muted-foreground">{hit.meta}</div>
              {companion.note && <div className="mt-1 text-xs text-muted-foreground">{companion.note}</div>}
            </Command.Item>
          ))}
        </Command.Group>

        {term.length < 2 && <p className="px-3 py-2 text-xs text-muted-foreground">Type two or more letters to search every series.</p>}
        {term.length >= 2 && (
          <Command.Group heading="Search all" className={groupCls}>
            {searching && <p role="status" className="px-3 py-2 text-muted-foreground">Searching…</p>}
            {!searching && shown.length === 0 && <p role="status" className="px-3 py-2 text-muted-foreground">No series found.</p>}
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
