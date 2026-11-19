import { card } from "@/lib/ui";

/** Server-rendered GET form: works without JS and keeps the active filters. */
export function SearchForm({ q = "", filters = {}, big = false, placeholder = "unemployment rate in India since 2015" }: {
  q?: string; filters?: Record<string, string | string[] | undefined>; big?: boolean; placeholder?: string;
}) {
  return (
    <form action="/" role="search" className={`${card} flex items-center gap-2 p-2 shadow-sm focus-within:border-accent ${big ? "sm:p-3" : ""}`}>
      <label htmlFor={big ? "ask-hero" : "ask"} className="sr-only">Ask anything about statistics</label>
      {Object.entries(filters).flatMap(([k, v]) => [v ?? []].flat().filter(Boolean).map((x) => <input key={`${k}=${x}`} type="hidden" name={k} value={x} />))}
      <input id={big ? "ask-hero" : "ask"} name="q" defaultValue={q} autoComplete="off" placeholder={placeholder}
        className={`min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-muted-foreground ${big ? "py-2 text-lg sm:text-xl" : "py-1.5"}`} />
      <button className={`rounded-lg bg-accent font-medium text-accent-foreground transition-opacity hover:opacity-90 ${big ? "px-5 py-2.5" : "px-4 py-1.5 text-sm"}`}>
        Ask
      </button>
    </form>
  );
}
