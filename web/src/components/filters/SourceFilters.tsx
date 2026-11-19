import Link from "next/link";
import { ACCESS, STATUS, TOPICS, sourceFiltersHref, toggleSource, type SourceFilters as F } from "@/lib/params";
import { REDIST_LABELS, kindLabel } from "@/lib/format";
import { chip } from "@/lib/ui";

type Group = { key: Exclude<keyof F, "q">; title: string; options: { id: string; label: string }[] };

/** Search box + chip groups for /sources. Plain links and a GET form: no client JS. */
export function SourceFilters({ f, kinds, showTopics }: { f: F; kinds: string[]; showTopics: boolean }) {
  const groups: Group[] = [
    { key: "kind", title: "Kind", options: kinds.map((k) => ({ id: k, label: kindLabel(k) })) },
    ...(showTopics ? [{ key: "topic" as const, title: "Topic", options: TOPICS.map((t) => ({ id: t, label: t })) }] : []),
    { key: "redistribute", title: "Licence", options: Object.entries(REDIST_LABELS).map(([id, label]) => ({ id, label })) },
    { key: "access", title: "Access", options: [...ACCESS] },
    { key: "status", title: "Status", options: [...STATUS] },
  ];
  return (
    <div className="mb-6 space-y-3">
      <form action="/sources" role="search" className="flex gap-2">
        {groups.flatMap((g) => f[g.key].map((v) => <input key={`${g.key}=${v}`} type="hidden" name={g.key} value={v} />))}
        <input name="q" defaultValue={f.q} aria-label="Search sources" placeholder="Search by name, id or description…" autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-accent" />
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90">Search</button>
      </form>
      {groups.map((g) => (
        <div key={g.key} className="flex flex-wrap items-center gap-2">
          <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</span>
          {g.options.map((o) => {
            const on = f[g.key].includes(o.id);
            return (
              <Link key={o.id} href={sourceFiltersHref(toggleSource(f, g.key, o.id))} aria-pressed={on}
                className={`${chip} ${on ? "border-accent bg-accent/10 font-medium text-accent" : ""}`}>{o.label}</Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
