"use client";
import Link from "next/link";
import { useState } from "react";
import { pillSummary, type SourceGroup } from "@/lib/chat/cited-sources";
import { seriesHref } from "@/lib/format";

const CAP = 12;

function Icon({ g, ring }: { g: SourceGroup; ring?: boolean }) {
  return (
    <span aria-hidden style={{ backgroundColor: g.color }}
      className={`grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold leading-none text-white ${ring ? "ring-2 ring-card" : ""}`}>
      {g.code.slice(0, 2)}
    </span>
  );
}

/** The cited sources as one pill; expands to the series, grouped by source. */
export function SourcesPill({ groups, unavailable = [] }: { groups: SourceGroup[]; unavailable?: string[] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (!groups.length) return null;
  const s = pillSummary(groups);
  // Rows per group once the overall cap is applied.
  const budget = all ? Infinity : CAP;
  const shownRows = groups.map((g, i) => groups.slice(0, i).reduce((n, h) => n + h.series.length, 0)).map((before, i) => groups[i].series.slice(0, Math.max(0, budget - before)));
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={`Sources: ${groups.map((g) => g.name).join(", ")}. ${s.seriesCount} series.`}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card py-1 pl-1.5 pr-3 hover:bg-muted">
        <span className="flex -space-x-1.5">{s.icons.map((g) => <Icon key={g.id} g={g} ring />)}</span>
        <span className="min-w-0 max-w-[16rem] truncate">{s.first}</span>
        {s.more > 0 && <span className="shrink-0 text-muted-foreground">+{s.more}</span>}
      </button>
      {open && (
        <div className="max-h-72 w-full basis-full space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-3">
          {groups.map((g, gi) => {
            const rows = shownRows[gi];
            if (!rows.length) return null;
            return (
              <div key={g.id}>
                <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon g={g} />{g.name}</h3>
                <ul className="space-y-0.5">
                  {rows.map((r) => (
                    <li key={r.id} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate" title={r.title ? `${r.title} (${r.id})` : r.id}>{r.title ?? r.id}</span>
                      {unavailable.includes(r.id)
                        ? <em className="shrink-0 text-xs text-muted-foreground">no longer available</em>
                        : <Link href={seriesHref(r.id)} className="shrink-0 text-xs text-accent underline">Open series</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {s.seriesCount > CAP && (
            <button type="button" onClick={() => setAll((a) => !a)} className="text-xs text-accent underline">
              {all ? "Show fewer" : `Show all ${s.seriesCount} series`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
