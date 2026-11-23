import Link from "next/link";
import { Sparkline } from "@/components/Sparkline";
import { AskAiButton } from "@/components/AskAiButton";
import { Badge, Latest, askOnCard, stretch } from "@/components/SeriesCards";
import { relatedSeries, type RelatedHit } from "@/lib/client";
import { hitStats, type SeriesStat } from "@/lib/data";
import { seriesHref, unitLabel } from "@/lib/format";
import { card } from "@/lib/ui";
import { OTHER_SOURCES, exploreHeading, groupRelated } from "./related";

const MAX = 6;

function Item({ h, s }: { h: RelatedHit; s?: SeriesStat }) {
  const source = h.source_id;
  return (
    <li className={`${card} group relative flex min-w-0 flex-col gap-2 p-3 transition-shadow hover:shadow-md`}>
      <div className="pr-16"><Badge>{source}</Badge></div>
      <h4 className="line-clamp-2 min-h-10 pr-16 text-sm font-medium leading-5">
        <Link href={seriesHref(h.series_id)} className={`hover:text-accent hover:underline ${stretch}`}>{h.title}</Link>
      </h4>
      <p className="line-clamp-2 text-xs leading-4 text-muted-foreground">{h.reason}</p>
      <div className="mt-auto min-h-[5.5rem] space-y-1">
        {s && (s.points.length > 0 || s.multi) ? (
          <>
            <Latest s={s} />
            {s.points.length >= 2 && <Sparkline points={s.points} freq={s.freq} unit={unitLabel(s.unit, s.unitMult)} height={40} />}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No data stored yet; opens on demand</p>
        )}
      </div>
      <AskAiButton target={{ kind: "series", id: h.series_id, title: h.title, source }} className={`absolute right-2 top-2 ${askOnCard}`} />
    </li>
  );
}

/** "Explore next": related series from the API (same-country indicators when `geo` is given). Renders nothing if the API fails or has none. */
export async function ExploreNext({ id, geo, countryName }: { id: string; geo?: string; countryName?: string | null }) {
  const hits = await relatedSeries(id, { geo, limit: MAX }).then((r) => r.hits.slice(0, MAX), () => [] as RelatedHit[]);
  if (!hits.length) return null;
  const stats = await hitStats(hits.map((h) => h.series_id));
  const { same, other } = groupRelated(hits);
  const grid = (xs: RelatedHit[]) => (
    <ul className="grid gap-3 sm:grid-cols-2">{xs.map((h) => <Item key={h.series_id} h={h} s={stats[h.series_id]} />)}</ul>
  );
  return (
    <section aria-labelledby="explore-next" className={`${card} space-y-4 p-5`}>
      <h2 id="explore-next" className="text-sm font-semibold">{exploreHeading(geo ? countryName ?? geo : null)}</h2>
      {same.length > 0 && grid(same)}
      {other.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{OTHER_SOURCES}</h3>
          {grid(other)}
        </div>
      )}
    </section>
  );
}
