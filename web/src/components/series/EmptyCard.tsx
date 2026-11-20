import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import type { EmptyReason } from "@/lib/shape";
import { btn, card } from "@/lib/ui";

/** Explains why a series has no chart. Never renders an empty chart. */
export function EmptyCard({ reason, source, sourceName }: { reason: EmptyReason; source: string; sourceName: string }) {
  return (
    <section aria-label="No data" className={`${card} space-y-4 p-5`}>
      <h2 className="text-lg font-semibold">{reason.title}</h2>
      {reason.detail && <p className="text-sm text-muted-foreground">{reason.detail}</p>}
      {reason.command && (
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs">{reason.command}</code>
          <CopyButton text={reason.command} label="Copy command" />
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/sources" className={btn}>{sourceName} on the sources page</Link>
        <Link href={`/search?source=${encodeURIComponent(source)}`} className={btn}>Search {sourceName}</Link>
        <Link href="/search" className={btn}>Search all series</Link>
      </div>
    </section>
  );
}
