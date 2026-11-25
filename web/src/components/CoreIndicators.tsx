import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { AskAiButton } from "./AskAiButton";
import { Badge, Latest, Trend, askOnCard, stretch } from "./SeriesCards";
import { cachedCore, geoNames, orElse, sourceList } from "@/lib/data";
import { seriesHref, shortSourceName } from "@/lib/format";
import { card } from "@/lib/ui";

async function Strip({ cols }: { cols: string }) {
  const [items, names, srcs] = await Promise.all([orElse("coreIndicators", cachedCore, []), geoNames(), sourceList()]);
  if (!items.length) return null;
  const short = new Map(srcs.map((s) => [s.id, shortSourceName(s.name)]));
  return (
    <section aria-labelledby="core">
      <h2 id="core" className="mb-1 text-xl font-semibold tracking-tight">Core indicators</h2>
      <p className="mb-4 text-sm text-muted-foreground">A few headline numbers about the world, each cited to its source. Medians across countries are computed from the source data.</p>
      <div className={`grid gap-4 ${cols}`}>
        {items.map(({ slot, stat: s }) => {
          const source = short.get(s.source_id ?? "") ?? s.source_id ?? "";
          return (
            <article key={slot.slot} className={`${card} group relative flex flex-col gap-3 p-4 transition-shadow hover:shadow-md`}>
              <div className="flex items-center gap-2 pr-16 text-xs text-muted-foreground"><Badge>{source}</Badge></div>
              <div>
                <h3 className="text-sm font-medium leading-5">
                  <Link href={seriesHref(s.id)} className={`hover:text-accent hover:underline ${stretch}`}>{slot.label}</Link>
                </h3>
                <p className="text-xs text-muted-foreground">{slot.about}</p>
              </div>
              <Latest s={s} names={names} />
              <Trend s={s} names={names} height={56} />
              <AskAiButton target={{ kind: "series", id: s.id, title: s.title ?? slot.label, source }} className={`absolute right-3 top-3 ${askOnCard}`} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Curated strip of headline indicators; renders nothing when fewer than 3 have data. */
export const CoreIndicators = ({ cols = "sm:grid-cols-2 lg:grid-cols-3", fallback = null }: { cols?: string; fallback?: ReactNode }) => (
  <Suspense fallback={fallback}><Strip cols={cols} /></Suspense>
);
