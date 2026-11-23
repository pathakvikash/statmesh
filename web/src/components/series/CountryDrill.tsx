"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/Sparkline";
import { SEXES, SEX_LABEL, trendOf, type Sex } from "@/lib/country-drill";
import type { DrillData } from "@/lib/country-drill-data";
import { countryHref, periodLabel, seriesHref } from "@/lib/format";

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 4 });
const seg = "inline-flex rounded-lg border border-border p-0.5 text-sm";
const segBtn = (on: boolean) => `rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`;
const link = "rounded-sm outline-none hover:text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent";

/**
 * Replaces the ranked bars in place for one country: headline, rank among peers, trend, a Male/Female switch
 * and, for Male/Female, the related indicators for that sex. Data comes from /api/country-drill (server-side lookups).
 * Focus lands on the heading when it opens; Escape calls onClose.
 */
export function CountryDrill({ idKey, geo, name, sex, query, onSex, onClose }: {
  idKey: string; geo: string; name: string; sex: Sex; query: Record<string, string | undefined>; onSex: (s: Sex) => void; onClose: () => void;
}) {
  const [data, setData] = useState<DrillData>();
  const [err, setErr] = useState("");
  const [shown, setShown] = useState(false); // opacity transition; motion-reduce turns it off in CSS
  const head = useRef<HTMLHeadingElement>(null);
  const dimQs = JSON.stringify(Object.entries(query).filter(([k, v]) => k.startsWith("dim.") && v));

  useEffect(() => { head.current?.focus(); const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  useEffect(() => {
    const ctl = new AbortController();
    const p = new URLSearchParams({ id: idKey, c: geo, sex });
    for (const [k, v] of JSON.parse(dimQs) as [string, string][]) p.set(k, v);
    fetch(`/api/country-drill?${p}`, { signal: ctl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.detail ?? r.statusText); setData(j as DrillData); setErr(""); })
      .catch((e: Error) => { if (e.name !== "AbortError") setErr(e.message); });
    return () => ctl.abort();
  }, [idKey, geo, sex, dimQs]);

  const ready = data && data.geo === geo && data.sex === sex ? data : undefined;
  const last = ready?.points.at(-1), tr = ready ? trendOf(ready.points) : null;
  const unit = ready?.unit ? ` ${ready.unit}` : "";
  const pageHref = countryHref(idKey, geo, query);

  return (
    <section aria-label={`${name} drill-down`} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      className={`space-y-4 transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onClose} className="rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">← Back to all countries</button>
        <Link href={pageHref} className={`text-sm font-medium ${link}`}>Open full country page →</Link>
      </div>
      <h3 ref={head} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">{name}</h3>

      <div role="group" aria-label="Sex" className={seg}>
        {SEXES.map((s) => (
          <button key={s} type="button" aria-pressed={sex === s} onClick={() => onSex(s)} className={segBtn(sex === s)}>{SEX_LABEL[s]}</button>
        ))}
      </div>

      <div aria-live="polite" aria-busy={!ready && !err} className="space-y-4">
        {err && <p role="alert" className="text-sm text-destructive">Could not load {name}: {err}</p>}
        {!ready && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
        {ready && (
          <>
            {sex !== "all" && !ready.split && (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">No male/female split is stored for this indicator. The related indicators below are the {SEX_LABEL[sex].toLowerCase()} ones stored for {name}.</p>
            )}
            {last ? (
              <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-end">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{fmt(last.v)}<span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span></div>
                  <div className="mt-1 text-sm text-muted-foreground">{sex !== "all" && ready.split ? `${SEX_LABEL[sex]}, ` : ""}{periodLabel(last.t, ready.freq)}</div>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {ready.rank && <li>Rank {ready.rank.rank} of {ready.rank.of} {ready.rank.noun} <span className="text-muted-foreground">(computed from the latest value per country; 1 = highest)</span></li>}
                    {tr && <li>{tr.delta >= 0 ? "Up" : "Down"} {fmt(Math.abs(tr.delta))}{unit}{tr.pct !== null ? ` (${Math.abs(tr.pct).toFixed(1)}%)` : ""} since {periodLabel(tr.from.t, ready.freq)} <span className="text-muted-foreground">(computed)</span></li>}
                    {!tr && <li className="text-muted-foreground">One period stored, so no trend.</li>}
                  </ul>
                </div>
                {ready.points.length >= 2 && <Sparkline points={ready.points} freq={ready.freq} unit={ready.unit} height={72} />}
              </div>
            ) : sex === "all" || ready.split ? <p className="text-sm text-muted-foreground">No {sex === "all" ? "" : `${SEX_LABEL[sex].toLowerCase()} `}value stored for {name} in this indicator.</p> : null}

            {sex !== "all" && (
              <div className="border-t border-border pt-4">
                <h4 className="mb-2 text-sm font-semibold">Related indicators, {SEX_LABEL[sex].toLowerCase()}, {name}</h4>
                {ready.related.length === 0 ? <p className="text-sm text-muted-foreground">No {SEX_LABEL[sex].toLowerCase()}-specific indicator with data for {name} found in the catalogue.</p> : (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {ready.related.map((r) => {
                      const l = r.points.at(-1)!;
                      return (
                        <li key={r.id} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-3">
                          <Link href={seriesHref(`${r.id}:${geo}`)} className={`line-clamp-2 text-sm font-medium leading-5 ${link}`}>{r.title}</Link>
                          <div className="text-lg font-semibold tabular-nums">{fmt(l.v)}<span className="ml-1 text-xs font-normal text-muted-foreground">{r.unit}</span></div>
                          <div className="text-xs text-muted-foreground">{periodLabel(l.t, r.freq)} · {r.kind === "split" ? `${SEX_LABEL[sex]} value of a stored split` : `title names ${SEX_LABEL[sex].toLowerCase()}`}</div>
                          <div className="text-xs text-muted-foreground">Source: {r.source}.</div>
                          {r.points.length >= 2 && <Sparkline points={r.points} freq={r.freq} unit={r.unit} height={36} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Source: {ready.source}.</p>
          </>
        )}
      </div>
    </section>
  );
}
