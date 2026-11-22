import { AskButton } from "@/components/AskButton";
import { card } from "@/lib/ui";

/** Server-rendered GET form: works without JS and keeps the active filters. */
export function SearchForm({ q = "", filters = {}, big = false, label = "Search", placeholder = "unemployment rate in India since 2015" }: {
  q?: string; filters?: Record<string, string | string[] | undefined>; big?: boolean; label?: string; placeholder?: string;
}) {
  const size = big ? "px-5 py-2.5" : "px-4 py-1.5 text-sm";
  return (
    <form action="/search" role="search" className={`${card} flex items-center gap-2 p-2 shadow-sm focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${big ? "sm:p-3" : ""}`}>
      <label htmlFor={big ? "ask-hero" : "ask"} className="sr-only">Search or ask about statistics</label>
      {Object.entries(filters).flatMap(([k, v]) => [v ?? []].flat().filter(Boolean).map((x) => <input key={`${k}=${x}`} type="hidden" name={k} value={x} />))}
      <input id={big ? "ask-hero" : "ask"} name="q" defaultValue={q} autoComplete="off" placeholder={placeholder}
        className={`min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-muted-foreground ${big ? "py-2 text-lg sm:text-xl" : "py-1.5"}`} />
      <button type="submit" className={`rounded-lg bg-accent font-medium text-accent-foreground transition-opacity hover:opacity-90 ${size}`}>
        {label}
      </button>
      <AskButton className={`rounded-lg border border-border font-medium transition-colors hover:bg-muted ${size}`} />
    </form>
  );
}
