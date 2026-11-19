"use client";
import { Command } from "cmdk";
import { useEffect, useRef, useState } from "react";
import { isEmptyScope, type Scope } from "@/lib/chat/scope";

export type SrcOpt = { id: string; name: string };
export type GeoOpt = { code: string; name: string };
const year = (d?: string) => d?.slice(0, 4) ?? "";
const pill = "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs";
const toggle = (xs: string[] | undefined, x: string) => (xs?.includes(x) ? xs.filter((y) => y !== x) : [...(xs ?? []), x]);

/** Scope chips above the composer: pickers on the left, active scope as removable chips. */
export function ScopeBar({ scope, onChange, sources, geos }: { scope: Scope; onChange: (s: Scope) => void; sources: SrcOpt[]; geos: GeoOpt[] }) {
  const [open, setOpen] = useState<"sources" | "geos" | "years" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState(year(scope.start));
  const [to, setTo] = useState(year(scope.end));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  // Keep the year drafts in step when the scope changes from outside (Clear, URL load).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrom(year(scope.start)); setTo(year(scope.end));
  }, [scope.start, scope.end]);

  const set = (p: Partial<Scope>) => onChange({ ...scope, ...p });
  const commitYear = (k: "start" | "end", v: string, setDraft: (v: string) => void) => {
    setDraft(v);
    if (v === "") set({ [k]: undefined });
    else if (/^\d{4}$/.test(v)) set({ [k]: k === "start" ? `${v}-01-01` : `${v}-12-31` });
  };
  const gname = (c: string) => geos.find((g) => g.code === c)?.name ?? c;
  const sname = (id: string) => sources.find((s) => s.id === id)?.name ?? id;
  const btn = (k: "sources" | "geos" | "years", label: string, n: number) => (
    <button type="button" aria-haspopup="dialog" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}
      className={`${pill} hover:bg-muted ${n ? "border-accent text-accent" : "text-muted-foreground"}`}>
      {label}{n ? ` · ${n}` : ""} <span aria-hidden>▾</span>
    </button>
  );
  const chips = [
    ...(scope.sources ?? []).map((s) => ({ key: "s" + s, text: sname(s), rm: () => set({ sources: toggle(scope.sources, s) }) })),
    ...(scope.geos ?? []).map((g) => ({ key: "g" + g, text: gname(g), rm: () => set({ geos: toggle(scope.geos, g) }) })),
    ...(scope.start || scope.end ? [{ key: "y", text: `${year(scope.start) || "…"}–${year(scope.end) || "…"}`, rm: () => set({ start: undefined, end: undefined }) }] : []),
  ];
  const popup = "absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-lg";

  return (
    <div ref={box} className="relative mb-2 px-1" role="group" aria-label="Scope">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Scope</span>
        {btn("sources", "Sources", scope.sources?.length ?? 0)}
        {btn("geos", "Countries", scope.geos?.length ?? 0)}
        {btn("years", "Years", scope.start || scope.end ? 1 : 0)}
        {chips.map((c) => (
          <span key={c.key} className={`${pill} bg-accent/10`}>
            {c.text}
            <button type="button" aria-label={`Remove ${c.text}`} onClick={c.rm} className="text-muted-foreground hover:text-foreground">×</button>
          </span>
        ))}
        {!isEmptyScope(scope) && <button type="button" onClick={() => onChange({})} className="text-xs text-muted-foreground underline hover:text-foreground">Clear</button>}
      </div>

      {open === "sources" && (
        <div role="dialog" aria-label="Choose sources" className={`${popup} max-h-72 overflow-y-auto p-1 text-sm`}>
          {sources.length === 0 && <p className="p-3 text-muted-foreground">No sources available.</p>}
          {sources.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted">
              <input type="checkbox" checked={!!scope.sources?.includes(s.id)} onChange={() => set({ sources: toggle(scope.sources, s.id) })} />
              <span className="truncate">{s.name}</span>
            </label>
          ))}
        </div>
      )}
      {open === "geos" && (
        <Command label="Choose countries" className={popup}>
          <Command.Input autoFocus placeholder="Search name or code…" className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground" />
          <Command.List className="max-h-64 overflow-y-auto p-1 text-sm">
            <Command.Empty className="px-3 py-4 text-center text-muted-foreground">No country matches.</Command.Empty>
            {geos.map((g) => (
              <Command.Item key={g.code} value={`${g.name} ${g.code}`} onSelect={() => set({ geos: toggle(scope.geos, g.code) })}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-1.5 data-[selected=true]:bg-muted">
                <span className="flex items-center gap-2"><span aria-hidden className="w-3">{scope.geos?.includes(g.code) ? "✓" : ""}</span>{g.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{g.code}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      )}
      {open === "years" && (
        <div role="dialog" aria-label="Choose years" className={`${popup} flex items-center gap-2 p-3 text-sm`}>
          <label className="flex-1">From
            <input type="number" min={1800} max={2200} placeholder="2000" value={from} onChange={(e) => commitYear("start", e.target.value, setFrom)}
              className="mt-1 w-full rounded-xl border border-border bg-background p-1.5" />
          </label>
          <label className="flex-1">To
            <input type="number" min={1800} max={2200} placeholder="2024" value={to} onChange={(e) => commitYear("end", e.target.value, setTo)}
              className="mt-1 w-full rounded-xl border border-border bg-background p-1.5" />
          </label>
        </div>
      )}
    </div>
  );
}
