import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { Sparkline } from "@/components/Sparkline";
import type { SeriesStat } from "@/lib/data";
import { formatCompact, periodLabel, seriesHref, unitLabel } from "@/lib/format";
import type { EmptyReason } from "@/lib/shape";
import { btn, card } from "@/lib/ui";

/** Explains why a series has no chart. Never renders an empty chart. */
export function EmptyCard({ reason, source, sourceName, related = [], lead }: {
  reason: EmptyReason; source: string; sourceName: string; related?: { id: string; title: string; stat: SeriesStat }[]; lead?: string;
}) {
  return (
    <section aria-label="No data" className={`${card} space-y-4 p-5`}>
      <h2 className="text-lg font-semibold">{reason.title}</h2>
      {reason.detail && <p className="text-sm text-muted-foreground">{reason.detail}</p>}
      {related.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Related series with data</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {related.map(({ id, title, stat }) => (
              <li key={id} className="rounded-lg border border-border p-3">
                <Link href={seriesHref(id)} className="text-sm font-medium hover:text-accent hover:underline">{title}</Link>
                <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {formatCompact(stat.points.at(-1)!.v)} {unitLabel(stat.unit, stat.unitMult)} ({periodLabel(stat.points.at(-1)!.t, stat.freq)}{stat.source_id ? `; ${stat.source_id}` : ""})
                </div>
                <Sparkline points={stat.points} freq={stat.freq} unit={stat.unit} height={40} />
              </li>
            ))}
          </ul>
        </div>
      ) : lead && <p className="text-sm">{lead}</p>}
      {reason.command && (
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">{reason.command}</code>
          <CopyButton text={reason.command} label="Copy command" />
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/sources/${encodeURIComponent(source)}`} className={btn}>{sourceName} source page</Link>
        <Link href={`/search?source=${encodeURIComponent(source)}`} className={btn}>Search {sourceName}</Link>
        <Link href="/search" className={btn}>Search all series</Link>
      </div>
    </section>
  );
}
