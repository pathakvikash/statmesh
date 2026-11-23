"use client";
import { Command } from "cmdk";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SeriesChart } from "./SeriesChart";
import { CountryDrill } from "./series/CountryDrill";
import { parseCountryParam, parseSexParam, withCountry, type Sex } from "@/lib/country-drill";
import { countryHref, formatCompact } from "@/lib/format";
import { geoSeriesSql, rankBars, widen } from "@/lib/multigeo";
import { geoByLabel } from "./series/lines-drill";

type Pt = { t: string; v: number };
const CAP = 10;
const seg = "inline-flex rounded-lg border border-border p-0.5 text-sm";
const segBtn = (on: boolean) => `rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`;
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Few periods: ranked horizontal bars of one period, Top/Bottom 20 and a country filter. */
/**
 * RankedBars whose bars open a country drill in place (`?c=IND`, linkable; never `?geo=`, that is Compare mode).
 * The bars stay mounted (hidden) while the drill shows, so the filter and Top/Bottom choice survive "Back to all countries".
 * Each bar keeps a real href to the country's own series page for open-in-new-tab and no-JS use.
 * A client wrapper: a server page cannot pass functions.
 */
export function CountryBars({ idKey, query, ...rest }: { idKey: string; query: Record<string, string | undefined> } & Omit<Parameters<typeof RankedBars>[0], "hrefFor" | "onPick">) {
  const sp = useSearchParams();
  const wrap = useRef<HTMLDivElement>(null);
  const c = parseCountryParam(sp.get("c")), sex = parseSexParam(sp.get("sex"));
  const names = useMemo(() => new Map(rest.rows.map((r) => [r.geo, r.name])), [rest.rows]);
  // Native history API: Next 16 syncs it with useSearchParams, so the URL stays linkable without a server round trip.
  const go = (geo: string | null, s: Sex = "all", replace = false) => {
    const url = `${window.location.pathname}${withCountry(window.location.search, geo, s)}`;
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
  };
  const closing = useRef(false);
  useEffect(() => { // after the bars are visible again, put focus back on their filter
    if (!c && closing.current) { closing.current = false; wrap.current?.querySelector<HTMLElement>("input[type=search]")?.focus(); }
  }, [c]);
  const close = () => { closing.current = true; go(null); };
  return (
    <div ref={wrap}>
      <div hidden={!!c}><RankedBars {...rest} hrefFor={(geo) => countryHref(idKey, geo, query)} onPick={(geo) => go(geo)} /></div>
      {c && <CountryDrill key={c} idKey={idKey} geo={c} name={names.get(c) ?? c} sex={sex} query={query} onSex={(s) => go(c, s, true)} onClose={close} />}
    </div>
  );
}

export function RankedBars({ rows, unit, period, noun = "countries", highlight, hrefFor, onPick }: { rows: { geo: string; name: string; v: number }[]; unit?: string | null; period: string; noun?: string; highlight?: string; hrefFor?: (geo: string) => string; onPick?: (geo: string) => void }) {
  const router = useRouter();
  const [dir, setDir] = useState<"top" | "bottom">("top");
  const [q, setQ] = useState("");
  const shown = useMemo(() => rankBars(rows, dir, q), [rows, dir, q]);
  const me = highlight ? rows.find((r) => r.geo === highlight) : undefined;
  const myRank = me ? 1 + rows.filter((r) => r.v > me.v).length : 0;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Ranking direction" className={seg}>
          {(["top", "bottom"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={dir === d} onClick={() => setDir(d)} className={segBtn(dir === d)}>{d === "top" ? "Top 20" : "Bottom 20"}</button>
          ))}
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filter ${rows.length} ${noun}…`} aria-label={`Filter ${noun}`}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:max-w-xs" />
        <span className="text-xs text-muted-foreground">{period}</span>
      </div>
      {shown.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No match for “{q}”.</p> : (
        <>
        <ul className="sr-only focus-within:not-sr-only focus-within:mb-3 focus-within:max-h-60 focus-within:space-y-1 focus-within:overflow-y-auto focus-within:rounded-lg focus-within:border focus-within:border-border focus-within:bg-card focus-within:p-2 focus-within:text-sm" aria-label={`${noun} ranked by value`}>
          {shown.map((r) => {
            const text = `${r.name}${r.geo === highlight ? " (this series)" : ""}: ${fmt(r.v)}${unit ? ` ${unit}` : ""}`;
            return <li key={r.geo}>{hrefFor ? <a href={hrefFor(r.geo)} className="rounded-sm outline-none focus-visible:underline focus-visible:ring-2 focus-visible:ring-accent"
              onClick={onPick ? (e) => { if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) { e.preventDefault(); onPick(r.geo); } } : undefined}
              onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); if (onPick) onPick(r.geo); else router.push(hrefFor(r.geo)); } }}>{text}</a> : text}</li>;
          })}
        </ul>
        {me && (
          <p className="mb-2 text-xs text-muted-foreground">
            <span aria-hidden className="mr-1 inline-block size-2 rounded-sm bg-accent" />
            {me.name} (this series, highlighted) ranks {myRank} of {rows.length}{shown.some((r) => r.geo === me.geo) ? "" : "; not among the bars shown"}.
          </p>
        )}
        <div role="img" aria-hidden="true" aria-label={`Ranked bar chart of ${shown.length} ${noun}${unit ? ` in ${unit}` : ""}`}
          className={hrefFor ? "[&_.recharts-bar-rectangle]:cursor-pointer [&_.recharts-bar-rectangle:hover]:opacity-75" : undefined} style={{ height: shown.length * 26 + 36 }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: shown.length * 26 + 36 }}>
            <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 0 }} barCategoryGap={4}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => formatCompact(v)} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} />
              <YAxis type="category" dataKey="name" width={150} interval={0} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={(n: string) => (n.length > 22 ? `${n.slice(0, 21)}…` : n)} />
              <Tooltip cursor={{ fill: "var(--color-muted)" }} content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as { name: string; v: number } | undefined) : undefined;
                return p ? (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm">
                    <div className="font-medium">{p.name}</div>
                    <div className="tabular-nums">{fmt(p.v)}{unit ? ` ${unit}` : ""}</div>
                  </div>
                ) : null;
              }} />
              <Bar dataKey="v" fill="var(--color-chart-1)" radius={[0, 3, 3, 0]} isAnimationActive={false}
                onClick={onPick ? (_: unknown, i: number) => onPick(shown[i].geo) : hrefFor ? (_: unknown, i: number) => router.push(hrefFor(shown[i].geo)) : undefined}>
                {highlight && shown.map((r) => <Cell key={r.geo} fill={r.geo === highlight ? "var(--color-accent)" : "var(--color-chart-1)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        </>
      )}
    </div>
  );
}

/**
 * Country picker: a button showing the count, and a cmdk list of checkboxes capped at `cap`.
 * Controlled: the caller owns `selected` and decides what a toggle does.
 */
export function GeoPicker({ noun = "countries", candidates, selected, cap, busy = false, onToggle }: {
  noun?: string; candidates: { geo: string; name: string; hint?: string }[]; selected: string[]; cap: number; busy?: boolean; onToggle: (geo: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [listId, setListId] = useState<string>(); // cmdk assigns the listbox its own id
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const on = new Set(selected);
  return (
    <div className="relative" ref={wrap}>
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted">
        <span className="capitalize">{noun}</span> <span className="text-muted-foreground">{selected.length}/{cap}</span>
      </button>
      {open && (
        <Command label={`Pick ${noun}`} className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          onKeyDown={(e) => e.key === "Escape" && close()}>
          <Command.Input autoFocus placeholder={`Search ${noun}…`} className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground" />
          <Command.List ref={(el) => { if (el) setListId(el.id); }} className="max-h-64 overflow-y-auto p-1 text-sm">
            <Command.Empty className="px-3 py-4 text-center text-muted-foreground">No match.</Command.Empty>
            {candidates.map((c) => {
              const picked = on.has(c.geo), full = !picked && selected.length >= cap;
              return (
                <Command.Item key={c.geo} aria-checked={picked} value={`${c.name} ${c.geo}`} disabled={full || busy} onSelect={() => onToggle(c.geo)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 data-[disabled=true]:opacity-40 data-[selected=true]:bg-muted">
                  <span aria-hidden className={`inline-flex size-4 items-center justify-center rounded border text-[10px] ${picked ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}>{picked ? "✓" : ""}</span>
                  <span className="truncate">{c.name}{c.hint && <span className="ml-1 text-xs text-muted-foreground">{c.hint}</span>}</span>
                  {picked && <span className="sr-only">(selected)</span>}
                </Command.Item>
              );
            })}
          </Command.List>
          <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">{selected.length >= cap ? `Limit of ${cap} reached. Remove one to add another.` : `Pick up to ${cap}.`}</p>
        </Command>
      )}
    </div>
  );
}

/** Many periods: lines for a picked set of geos (cap 10), loaded on demand through the SQL proxy. */
export function GeoLines({ idKey, query = {}, freq, dk, sel, unit, candidates, initial, noun = "countries" }: {
  idKey: string; query?: Record<string, string | undefined>; noun?: string; freq: string | null; dk: string | null; sel?: Record<string, string>; unit?: string | null;
  candidates: { geo: string; name: string }[]; initial: Record<string, Pt[]>;
}) {
  const [data, setData] = useState(initial);
  // Stable colour slot per geo: removing one line never recolours the others.
  const [slots, setSlots] = useState<Record<string, number>>(() => Object.fromEntries(Object.keys(initial).map((g, i) => [g, i])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const names = useMemo(() => new Map(candidates.map((c) => [c.geo, c.name])), [candidates]);
  const geos = Object.keys(data);
  // In-place country drill (`?c=`), as on the bars: the chart stays mounted but hidden, so lines, range and chips survive Back.
  const sp = useSearchParams();
  const wrap = useRef<HTMLDivElement>(null), back = useRef<string | null>(null);
  const c = parseCountryParam(sp.get("c")), sex = parseSexParam(sp.get("sex"));
  const go = (geo: string | null, s: Sex = "all", replace = false) => {
    window.history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${withCountry(window.location.search, geo, s)}`);
  };
  useEffect(() => { // after the chart is visible again, focus the chip that opened the drill
    if (!c && back.current) { wrap.current?.querySelector<HTMLElement>(`[data-drill="${back.current}"]`)?.focus(); back.current = null; }
  }, [c]);
  const open = (geo: string) => { back.current = geo; go(geo); };
  // Recharts draws lines and legend entries as SVG: delegate a click on either to the matching geo (chips are the keyboard route).
  const pick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    const item = t.closest(".recharts-legend-item");
    if (item) { const g = geoByLabel(item.textContent ?? "", geos, names); if (g) open(g); return; }
    const line = t.closest(".recharts-line");
    const i = line ? Array.from(wrap.current?.querySelectorAll(".recharts-line") ?? []).indexOf(line) : -1;
    if (geos[i]) open(geos[i]);
  };
  const rows = useMemo(() => widen(Object.entries(data).flatMap(([geo, pts]) => pts.map((p) => ({ geo, ...p })))), [data]);

  async function toggle(geo: string) {
    setErr("");
    if (data[geo]) {
      setSlots((s) => Object.fromEntries(Object.entries(s).filter(([g]) => g !== geo)));
      return setData((d) => Object.fromEntries(Object.entries(d).filter(([g]) => g !== geo)));
    }
    if (geos.length >= CAP) return;
    setBusy(geo);
    try {
      const r = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: geoSeriesSql(idKey, freq, dk, [geo], sel) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? r.statusText);
      const pts: Pt[] = (j.rows as [string, string, number][]).map(([, t, v]) => ({ t, v }));
      setSlots((s) => { const used = new Set(Object.values(s)); let i = 0; while (used.has(i)) i++; return { ...s, [geo]: i }; });
      setData((d) => ({ ...d, [geo]: pts }));
    } catch (e) {
      setErr(`Could not load ${names.get(geo) ?? geo}: ${(e as Error).message}`);
    }
    setBusy(null);
  }

  return (
    <div ref={wrap}>
      <div hidden={!!c}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GeoPicker noun={noun} candidates={candidates} selected={geos} cap={CAP} busy={busy !== null} onToggle={toggle} />
        {geos.map((g) => (
          <span key={g} className="inline-flex items-center rounded-full border border-border bg-card text-xs">
            <button type="button" data-drill={g} onClick={() => open(g)} aria-label={`Drill into ${names.get(g) ?? g}`} title="Drill into this country"
              className="rounded-l-full py-0.5 pl-2.5 pr-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent">
              {names.get(g) ?? g} <span aria-hidden className="text-muted-foreground">↗</span>
            </button>
            <button type="button" onClick={() => toggle(g)} aria-label={`Remove ${names.get(g) ?? g}`}
              className="rounded-r-full py-0.5 pl-1 pr-2.5 text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-accent"><span aria-hidden>×</span></button>
          </span>
        ))}
        {busy && <span role="status" className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      {err && <p role="alert" className="mb-2 text-xs text-destructive">{err}</p>}
      {geos.length ? (
        <div onClick={pick} className="[&_.recharts-legend-item]:cursor-pointer [&_.recharts-line]:cursor-pointer">
          <SeriesChart rows={rows} lines={geos.map((g) => ({ key: g, label: names.get(g) ?? g, slot: slots[g] }))} unit={unit} freq={freq} presets />
        </div>
      ) : <p className="py-10 text-center text-sm text-muted-foreground">Pick one to draw its line.</p>}
      </div>
      {c && <CountryDrill key={c} idKey={idKey} geo={c} name={names.get(c) ?? c} sex={sex} query={query} onSex={(s) => go(c, s, true)} onClose={() => go(null)} />}
    </div>
  );
}
