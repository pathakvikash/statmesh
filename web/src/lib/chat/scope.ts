import { z } from "zod";

const code = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/);
export const scopeSchema = z.object({
  sources: z.array(code).max(50).optional(),
  geos: z.array(code).max(300).optional(),
  start: z.string().regex(/^\d{4}-01-01$/).optional(),
  end: z.string().regex(/^\d{4}-12-31$/).optional(),
});
export type Scope = z.infer<typeof scopeSchema>;

export const isEmptyScope = (s: Scope) => !s.sources?.length && !s.geos?.length && !s.start && !s.end;
const year = (d?: string) => d?.slice(0, 4);

/** Drop empty fields so the request body and URL stay minimal. */
export function normalizeScope(s: Scope): Scope {
  const o: Scope = {};
  if (s.sources?.length) o.sources = s.sources;
  if (s.geos?.length) o.geos = s.geos;
  if (s.start) o.start = s.start;
  if (s.end) o.end = s.end;
  return o;
}

/** ?scope_sources=a,b&scope_geos=IND,BGD&from=2015&to=2020 -> Scope (invalid parts are ignored). */
export function parseScopeParams(p: URLSearchParams): Scope {
  const list = (k: string) => p.get(k)?.split(",").map((x) => x.trim()).filter(Boolean);
  const y = (k: string) => (/^\d{4}$/.test(p.get(k) ?? "") ? p.get(k)! : undefined);
  const from = y("from"), to = y("to");
  const raw = { sources: list("scope_sources"), geos: list("scope_geos"), start: from && `${from}-01-01`, end: to && `${to}-12-31` };
  const r = scopeSchema.safeParse(raw);
  return r.success ? normalizeScope(r.data) : {};
}

/** Writes the scope into p (removing stale scope keys first). */
export function writeScopeParams(p: URLSearchParams, s: Scope): URLSearchParams {
  for (const k of ["scope_sources", "scope_geos", "from", "to"]) p.delete(k);
  if (s.sources?.length) p.set("scope_sources", s.sources.join(","));
  if (s.geos?.length) p.set("scope_geos", s.geos.join(","));
  if (s.start) p.set("from", year(s.start)!);
  if (s.end) p.set("to", year(s.end)!);
  return p;
}

/** Appended to the system prompt; "" when the scope is empty. Codes are regex-validated, so safe to inline. */
export function scopeParagraph(s: Scope, geoNames: Record<string, string> = {}): string {
  const parts = [
    s.sources?.length && `sources ${s.sources.join(", ")}`,
    s.geos?.length && `countries ${s.geos.map((g) => (geoNames[g] ? `${geoNames[g]} (${g})` : g)).join(", ")}`,
    (s.start || s.end) && `years ${year(s.start) ?? "any"} to ${year(s.end) ?? "any"}`,
  ].filter(Boolean);
  return parts.length ? `\n\nStay inside this scope: ${parts.join("; ")}. If the answer lies outside it, say so.` : "";
}

type Exec = (input: Record<string, unknown>, opts: never) => unknown;
type AnyTool = { execute?: Exec } & Record<string, unknown>;

/**
 * Wrap MCP tools so omitted arguments (undefined, null or "") take the scope as defaults (the model's
 * explicit values win). search_series takes a source list but a single geo, so a multi-country scope
 * is only guarded by the system-prompt paragraph. ponytail: fan out per geo if that is not enough.
 */
export function withScopeDefaults<T extends Record<string, unknown>>(tools: T, s: Scope): T {
  const defaults: Record<string, Record<string, string | string[] | undefined>> = {
    search_series: { source: s.sources?.length ? s.sources : undefined, geo: s.geos?.length === 1 ? s.geos[0] : undefined },
    get_observations: { start: s.start, end: s.end },
  };
  const out: Record<string, unknown> = { ...tools };
  for (const [name, d] of Object.entries(defaults)) {
    const t = out[name] as AnyTool | undefined;
    const run = t?.execute;
    if (!t || !run) continue;
    const fill = Object.fromEntries(Object.entries(d).filter(([, v]) => v?.length));
    if (!Object.keys(fill).length) continue;
    out[name] = {
      ...t,
      execute: (input: Record<string, unknown>, opts: never) => {
        const given = Object.fromEntries(Object.entries(input ?? {}).filter(([, v]) => v != null && v !== ""));
        return run({ ...fill, ...given }, opts);
      },
    };
  }
  return out as T;
}

/** show_chart: same defaults for start/end. */
export const chartDefaults = <I extends { start?: string; end?: string }>(i: I, s: Scope): I => ({ ...i, start: i.start ?? s.start, end: i.end ?? s.end });
