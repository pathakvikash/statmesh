"use client";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SeriesChart } from "./SeriesChart";
import { formatCompact } from "@/lib/format";
import { geoSeriesSql, rankBars, widen } from "@/lib/multigeo";

type Pt = { t: string; v: number };
const CAP = 10;
const seg = "inline-flex rounded-lg border border-border p-0.5 text-sm";
const segBtn = (on: boolean) => `rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`;
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Few periods: ranked horizontal bars of one period, Top/Bottom 20 and a country filter. */
export function RankedBars({ rows, unit, period, noun = "countries" }: { rows: { geo: string; name: string; v: number }[]; unit?: string | null; period: string; noun?: string }) {
  const [dir, setDir] = useState<"top" | "bottom">("top");
  const [q, setQ] = useState("");
  const shown = useMemo(() => rankBars(rows, dir, q), [rows, dir, q]);
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
        <ul className="sr-only" aria-label={`${noun} ranked by value`}>
          {shown.map((r) => <li key={r.geo}>{r.name}: {fmt(r.v)}{unit ? ` ${unit}` : ""}</li>)}
        </ul>
        <div role="img" aria-hidden="true" aria-label={`Ranked bar chart of ${shown.length} ${noun}${unit ? ` in ${unit}` : ""}`} style={{ height: shown.length * 26 + 36 }}>
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
              <Bar dataKey="v" fill="var(--color-chart-1)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
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
export function GeoLines({ idKey, freq, dk, sel, unit, candidates, initial, noun = "countries" }: {
  idKey: string; noun?: string; freq: string | null; dk: string | null; sel?: Record<string, string>; unit?: string | null;
  candidates: { geo: string; name: string }[]; initial: Record<string, Pt[]>;
}) {
  const [data, setData] = useState(initial);
  // Stable colour slot per geo: removing one line never recolours the others.
  const [slots, setSlots] = useState<Record<string, number>>(() => Object.fromEntries(Object.keys(initial).map((g, i) => [g, i])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const names = useMemo(() => new Map(candidates.map((c) => [c.geo, c.name])), [candidates]);
  const geos = Object.keys(data);
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
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GeoPicker noun={noun} candidates={candidates} selected={geos} cap={CAP} busy={busy !== null} onToggle={toggle} />
        {geos.map((g) => (
          <button key={g} type="button" onClick={() => toggle(g)} aria-label={`Remove ${names.get(g) ?? g}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs transition-colors hover:bg-muted">
            {names.get(g) ?? g} <span aria-hidden className="text-muted-foreground">×</span>
          </button>
        ))}
        {busy && <span role="status" className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      {err && <p role="alert" className="mb-2 text-xs text-destructive">{err}</p>}
      {geos.length ? (
        <SeriesChart rows={rows} lines={geos.map((g) => ({ key: g, label: names.get(g) ?? g, slot: slots[g] }))} unit={unit} freq={freq} presets />
      ) : <p className="py-10 text-center text-sm text-muted-foreground">Pick one to draw its line.</p>}
    </div>
  );
}
