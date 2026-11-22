import { freqLabel } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;

/** Frequency toggle: one link per frequency, each keeping the other params. */
export function FreqToggle({ opts, value, sp }: { opts: string[]; value: string; sp: SP }) {
  const base = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])) as [string, string][]);
  return (
    <div role="group" aria-label="Frequency" className="mb-4 inline-flex flex-wrap rounded-lg border border-border p-0.5 text-sm">
      {opts.map((f) => {
        const u = new URLSearchParams(base);
        u.set("freq", f);
        const on = f === value;
        return (
          <a key={f} href={`?${u}`} aria-current={on ? "true" : undefined}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {freqLabel(f) ?? f}
          </a>
        );
      })}
    </div>
  );
}

/** Tabs as server-rendered ?tab= links, each keeping the other params. */
export function TabLinks({ tabs, value, sp }: { tabs: { id: string; label: string }[]; value: string; sp: SP }) {
  const base = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])) as [string, string][]);
  return (
    <nav aria-label="Series views" className="inline-flex flex-wrap rounded-lg border border-border p-0.5 text-sm">
      {tabs.map((t) => {
        const u = new URLSearchParams(base);
        u.set("tab", t.id);
        const on = t.id === value;
        return (
          <a key={t.id} href={`?${u}`} aria-current={on ? "page" : undefined}
            className={`rounded-md px-3 py-1 font-medium transition-colors ${on ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
