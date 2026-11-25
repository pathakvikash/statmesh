import { filtersHref, hasFilters, parseFilters, toRaw } from "@/lib/params";

/** Search URL for an old home link that carries a query or filters; null for a plain home visit. */
export function legacyTarget(p: URLSearchParams): string | null {
  const f = parseFilters(toRaw(p));
  return f.q || hasFilters(f) ? filtersHref(f) : null;
}
