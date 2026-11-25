"use client";
import { useEffect, useMemo, useState } from "react";
import { buildQuery, type Show } from "@/lib/sql-builder";
import { findGeo } from "@/lib/sql-geo";
import { EXAMPLES, EXAMPLE_GROUPS } from "@/lib/sql-examples";

type Hit = { id: string; title: string; meta: string; geo?: string | null; freq?: string | null };
const SHOWS: { v: Show; label: string }[] = [
  { v: "latest", label: "The latest number" },
  { v: "trend", label: "How it changed over time" },
  { v: "compare", label: "Compare places side by side" },
  { v: "topN", label: "The highest places" },
];
const field = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm";
const btn = "inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-50";

export function Guided({ geos, onRun, onEdit }: { geos: { code: string; name: string }[]; onRun: (sql: string) => void; onEdit: (sql: string) => void }) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Hit>();
  const [sel, setSel] = useState<string[]>(geos.some((g) => g.code === "IND") ? ["IND"] : []);
  const [geoText, setGeoText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [show, setShow] = useState<Show>("trend");
  const [n, setN] = useState("10");

  // Debounced search; a stale response is ignored.
  useEffect(() => {
    const q = term.trim();
    /* eslint-disable react-hooks/set-state-in-effect -- reset results when the box is emptied */
    if (q.length < 2 || q === pick?.title) { setHits([]); setSearching(false); return; }
    setSearching(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = (await (await fetch(`/api/palette?q=${encodeURIComponent(q)}`)).json()) as Hit[];
        if (live) setHits(Array.isArray(r) ? r : []);
      } catch { if (live) setHits([]); }
      if (live) setSearching(false);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [term, pick]);

  const names = useMemo(() => Object.fromEntries(geos.map((g) => [g.code, g.name])), [geos]);
  const built = useMemo(() => {
    if (!pick) return { msg: "Search for something to measure, such as unemployment or inflation." };
    try {
      // series_id is key:geo and a geo may hold a colon, so the key is the first three parts.
      const seriesKey = pick.id.split(":").slice(0, 3).join(":");
      return buildQuery({ seriesKey, title: pick.title, geos: sel, geoNames: names, freq: pick.freq ?? undefined, show, n: Number(n), fromYear: from ? Number(from) : undefined, toYear: to ? Number(to) : undefined });
    } catch (e) { return { msg: (e as Error).message }; }
  }, [pick, sel, names, show, n, from, to]);
  const ok = "sql" in built;

  function addGeo(text: string) {
    const g = findGeo(geos, text);
    if (g && !sel.includes(g.code)) setSel([...sel, g.code]);
    if (g) setGeoText("");
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Build a question step by step</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="relative md:col-span-2">
            <label htmlFor="g-find" className="mb-1 block text-sm font-medium">1. What do you want to look up?</label>
            <input id="g-find" className={field} value={term} onChange={(e) => { setTerm(e.target.value); setPick(undefined); }} placeholder="For example: unemployment, inflation, child stunting" autoComplete="off" />
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">{searching ? "Searching…" : term.trim().length >= 2 && !pick && !hits.length ? "Nothing found. Try a simpler word." : pick ? `Chosen: ${pick.title}` : ""}</p>
            {hits.length > 0 && (
              <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-background">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => { setPick(h); setTerm(h.title); setHits([]); if (h.geo) setSel([h.geo]); }} className="block min-h-10 w-full px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{h.title}</span> <span className="text-xs text-muted-foreground">{h.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label htmlFor="g-geo" className="mb-1 block text-sm font-medium">2. Which country or state?</label>
            <div className="flex gap-2">
              <input id="g-geo" list="g-geos" className={field} value={geoText} placeholder="Type a name, then Add"
                onChange={(e) => {
                  setGeoText(e.target.value);
                  // Only a datalist choice adds on its own; typing waits for Enter or Add, so "Indonesia" never adds India on the way.
                  const t = (e.nativeEvent as InputEvent).inputType;
                  if (!t || t === "insertReplacementText") addGeo(e.target.value);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGeo(geoText); } }} />
              <button type="button" className={btn} onClick={() => addGeo(geoText)}>Add</button>
            </div>
            <datalist id="g-geos">{geos.map((g) => <option key={g.code} value={g.name} />)}</datalist>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Chosen places">
              {sel.map((c) => (
                <li key={c}><button type="button" onClick={() => setSel(sel.filter((x) => x !== c))} aria-label={`Remove ${names[c] ?? c}`} className="inline-flex h-10 items-center gap-1 rounded-full border border-border bg-muted px-3 text-sm">{names[c] ?? c} <span aria-hidden>×</span></button></li>
              ))}
              {!sel.length && <li className="text-xs text-muted-foreground">No place chosen: every place is included.</li>}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="g-from" className="mb-1 block text-sm font-medium">3. From year</label>
              <input id="g-from" type="number" inputMode="numeric" min={1900} max={2100} className={field} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="2015" />
            </div>
            <div>
              <label htmlFor="g-to" className="mb-1 block text-sm font-medium">To year</label>
              <input id="g-to" type="number" inputMode="numeric" min={1900} max={2100} className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="2024" />
            </div>
          </div>
          <fieldset className="md:col-span-2">
            <legend className="mb-1 text-sm font-medium">4. What to show</legend>
            <div className="flex flex-wrap gap-2">
              {SHOWS.map((s) => (
                <label key={s.v} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:bg-muted">
                  <input type="radio" name="g-show" value={s.v} checked={show === s.v} onChange={() => setShow(s.v)} /> {s.label}
                </label>
              ))}
            </div>
            {show === "topN" && (
              <div className="mt-3 max-w-40">
                <label htmlFor="g-n" className="mb-1 block text-sm font-medium">How many places?</label>
                <input id="g-n" type="number" min={1} max={100} className={field} value={n} onChange={(e) => setN(e.target.value)} />
              </div>
            )}
          </fieldset>
        </div>
        <div aria-live="polite" className="space-y-2">
          <p className={`text-sm ${ok ? "" : "text-muted-foreground"}`}>{ok ? built.sentence : built.msg}</p>
          <pre aria-label="The generated SQL" className="max-h-60 overflow-auto rounded-lg border border-border bg-background p-3 text-xs">{ok ? built.sql : "-- Your SQL will appear here"}</pre>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!ok} onClick={() => ok && onRun(built.sql)} className="inline-flex h-10 items-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-50">Run</button>
          <button type="button" disabled={!ok} onClick={() => ok && onEdit(built.sql)} className={btn}>Edit this SQL</button>
        </div>
      </section>

      <section className="space-y-4" aria-label="Ready-made examples">
        <h2 className="text-base font-semibold">Or start from an example</h2>
        {EXAMPLE_GROUPS.map((g) => (
          <div key={g}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{g}</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EXAMPLES.filter((e) => e.group === g).map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onRun(e.sql)} className="flex min-h-10 w-full flex-col items-start gap-1 rounded-xl border border-border bg-card p-3 text-left hover:bg-muted">
                    <span className="text-sm font-medium">{e.title}</span>
                    <span className="text-xs text-muted-foreground">{e.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
