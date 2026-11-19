"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Command } from "cmdk";
import { useEffect, useRef, useState, useTransition } from "react";
import { FREQ_OPTIONS } from "@/lib/format";
import { LICENCE_OPTIONS, TOPICS, UPDATED_OPTIONS, sinceDate, updatedPreset } from "@/lib/params";

type Geo = { code: string; name: string };
type Src = { id: string; name: string; series: number };

export function Filters({ geos, sources }: { geos: Geo[]; sources: Src[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [show, setShow] = useState(false); // mobile collapse
  const [geoOpen, setGeoOpen] = useState(false);
  const geoBtn = useRef<HTMLButtonElement>(null);
  const geoBox = useRef<HTMLDivElement>(null);
  const geo = sp.get("geo") ?? "", freq = sp.get("freq") ?? "";
  const sources_ = sp.getAll("source"), topics = sp.getAll("topic");
  const [srcQ, setSrcQ] = useState(""), [srcAll, setSrcAll] = useState(false);

  // Close the country popup on an outside click.
  useEffect(() => {
    if (!geoOpen) return;
    const off = (e: PointerEvent) => { if (!geoBox.current?.contains(e.target as Node)) setGeoOpen(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [geoOpen]);

  const push = (p: URLSearchParams) => start(() => router.push(`/?${p}`));
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    push(p);
  };
  /** Add or remove one value of a repeatable param. */
  const toggle = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString()), cur = p.getAll(k);
    p.delete(k);
    (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]).forEach((x) => p.append(k, x));
    push(p);
  };
  const srcShown = sources.filter((s) => !srcQ || `${s.name} ${s.id}`.toLowerCase().includes(srcQ.toLowerCase()));
  const srcRows = srcAll || srcQ ? srcShown : srcShown.filter((s, i) => i < 8 || sources_.includes(s.id));
  const row = (on: boolean) => `flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${on ? "bg-accent/10 font-medium text-accent" : "hover:bg-muted"}`;
  const pill = (on: boolean) => `cursor-pointer rounded-lg border px-3 py-1.5 text-center text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${on ? "border-accent bg-accent/10 font-medium text-accent" : "border-border hover:bg-muted"}`;
  const geoLabel = geos.find((g) => g.code === geo)?.name ?? (geo || "Any country");
  const label = "mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <aside aria-label="Filters" aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : ""}>
      <button type="button" aria-expanded={show} onClick={() => setShow((s) => !s)}
        className="mb-3 flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium lg:hidden">
        Filters <span aria-hidden>{show ? "−" : "+"}</span>
      </button>
      <div className={`${show ? "block" : "hidden"} space-y-6 lg:block`}>
        <div ref={geoBox}>
          <span id="geo-l" className={label}>Country</span>
          <button ref={geoBtn} type="button" aria-labelledby="geo-l" aria-haspopup="listbox" aria-expanded={geoOpen}
            onClick={() => setGeoOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-muted">
            <span className={geo ? "" : "text-muted-foreground"}>{geoLabel}</span>
            <span aria-hidden className="text-muted-foreground">▾</span>
          </button>
          {geoOpen && (
            <Command label="Choose a country"
              onKeyDown={(e) => { if (e.key === "Escape") { setGeoOpen(false); geoBtn.current?.focus(); } }}
              className="mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-md">
              <Command.Input autoFocus placeholder="Search name or code…"
                className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground" />
              <Command.List className="max-h-64 overflow-y-auto p-1 text-sm">
                <Command.Empty className="px-3 py-4 text-center text-muted-foreground">No country matches.</Command.Empty>
                <Command.Item value="any country all" onSelect={() => { set("geo", ""); setGeoOpen(false); }}
                  className="cursor-pointer rounded-md px-3 py-1.5 data-[selected=true]:bg-muted">Any country</Command.Item>
                {geos.map((g) => (
                  <Command.Item key={g.code} value={`${g.name} ${g.code}`} onSelect={() => { set("geo", g.code); setGeoOpen(false); geoBtn.current?.focus(); }}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-1.5 data-[selected=true]:bg-muted">
                    <span>{g.name}</span><span className="font-mono text-xs text-muted-foreground">{g.code}</span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          )}
        </div>

        <fieldset>
          <legend className={label}>Frequency</legend>
          <div className="grid grid-cols-2 gap-1">
            {FREQ_OPTIONS.map((o) => (
              <label key={o.value || "any"} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-center text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${freq === o.value ? "border-accent bg-accent/10 font-medium text-accent" : "border-border hover:bg-muted"}`}>
                <input type="radio" name="freq" value={o.value} checked={freq === o.value} onChange={() => set("freq", o.value)} className="sr-only" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Topic</legend>
          <div className="space-y-0.5">
            {TOPICS.map((t) => (
              <label key={t} className={row(topics.includes(t))}>
                <input type="checkbox" checked={topics.includes(t)} onChange={() => toggle("topic", t)} className="accent-accent" />
                <span className="mr-auto truncate">{t}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Source</legend>
          {sources.length > 8 && (
            <input type="search" value={srcQ} onChange={(e) => setSrcQ(e.target.value)} placeholder="Find a source…" aria-label="Find a source"
              className="mb-2 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:border-accent" />
          )}
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {srcRows.map((s) => (
              <label key={s.id} className={row(sources_.includes(s.id))}>
                <input type="checkbox" checked={sources_.includes(s.id)} onChange={() => toggle("source", s.id)} className="accent-accent" />
                <span className="mr-auto truncate">{s.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{s.series}</span>
              </label>
            ))}
            {!srcRows.length && <p className="px-3 py-2 text-sm text-muted-foreground">No source matches.</p>}
          </div>
          {!srcQ && srcShown.length > 8 && (
            <button type="button" onClick={() => setSrcAll((a) => !a)} className="mt-1 px-3 text-sm text-accent hover:underline">
              {srcAll ? "Show fewer" : `Show all ${srcShown.length}`}
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend className={label}>Coverage years</legend>
          <div className="flex items-center gap-2">
            {(["start_year", "end_year"] as const).map((k, i) => (
              <span key={k} className="contents">
                {i > 0 && <span aria-hidden className="text-muted-foreground">–</span>}
                <input key={sp.get(k) ?? ""} type="number" inputMode="numeric" min={1800} max={2100} defaultValue={sp.get(k) ?? ""}
                  placeholder={i ? "To" : "From"} aria-label={i ? "To year" : "From year"}
                  onBlur={(e) => { if (e.target.value !== (sp.get(k) ?? "")) set(k, /^\d{4}$/.test(e.target.value) ? e.target.value : ""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  className="w-full min-w-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground focus:border-accent" />
              </span>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Updated</legend>
          <div className="grid grid-cols-1 gap-1">
            {UPDATED_OPTIONS.map((o) => {
              const on = updatedPreset(sp.get("updated_since") ?? undefined) === o.id;
              return (
                <label key={o.id || "any"} className={pill(on)}>
                  <input type="radio" name="updated" checked={on} onChange={() => set("updated_since", sinceDate(o.id) ?? "")} className="sr-only" />
                  {o.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Licence</legend>
          <div className="grid grid-cols-1 gap-1">
            {LICENCE_OPTIONS.map((o) => (
              <label key={o.value || "any"} title={o.hint} className={pill((sp.get("redistribute") ?? "") === o.value)}>
                <input type="radio" name="licence" checked={(sp.get("redistribute") ?? "") === o.value} onChange={() => set("redistribute", o.value)} className="sr-only" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </aside>
  );
}
