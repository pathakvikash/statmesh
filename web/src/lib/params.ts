/** Next searchParams values are string | string[] | undefined (repeated keys give arrays): take the first string. */
export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
/** Every non-empty value of a repeatable param, de-duplicated, in order. */
export const all = (v: string | string[] | undefined): string[] =>
  [...new Set((Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => x.trim()).filter(Boolean))];

export type RawParams = Record<string, string | string[] | undefined>;
export const TOPICS = ["Health", "Economy", "Labour", "Prices", "Trade", "Population", "Environment", "Energy", "Companies"] as const;
export const REDISTRIBUTE = ["yes", "review", "no"] as const;
/** Plain-words licence labels with the explanation shown as a tooltip. */
export const LICENCE_OPTIONS = [
  { value: "", label: "Any", hint: "Show every series, whatever its licence." },
  { value: "yes", label: "Redistributable", hint: "You may copy and republish the data, with the credit line shown on each series." },
  { value: "review", label: "Check terms", hint: "The provider's terms are unclear or vary by series: read them before you republish." },
  { value: "no", label: "Not redistributable", hint: "Fine to look at and analyse, but you may not republish the data." },
] as const;

export type Filters = {
  q: string; geo?: string; freq?: string; source: string[]; topic: string[];
  start_year?: string; end_year?: string; updated_since?: string; redistribute?: string;
};
const year = (v?: string) => (v && /^\d{4}$/.test(v.trim()) ? v.trim() : undefined);
/** YYYY-MM-DD that is a real calendar day (2026-02-30 is rejected). */
export const isoDate = (v?: string) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined;
};

/** URL -> filters. Unknown topics, bad years/dates and unknown licences are dropped. */
export function parseFilters(sp: RawParams): Filters {
  const redistribute = first(sp.redistribute);
  return {
    q: (first(sp.q) ?? "").trim(), geo: first(sp.geo) || undefined, freq: first(sp.freq) || undefined,
    source: all(sp.source), topic: all(sp.topic).filter((t) => (TOPICS as readonly string[]).includes(t)),
    start_year: year(first(sp.start_year)), end_year: year(first(sp.end_year)),
    updated_since: isoDate(first(sp.updated_since)),
    redistribute: (REDISTRIBUTE as readonly string[]).includes(redistribute ?? "") ? redistribute : undefined,
  };
}

/** Filters -> URL query (inverse of parseFilters). */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const k of ["geo", "freq", "start_year", "end_year", "updated_since", "redistribute"] as const) if (f[k]) p.set(k, f[k]!);
  f.source.forEach((s) => p.append("source", s));
  f.topic.forEach((t) => p.append("topic", t));
  return p;
}
/** The search/explore page. `/?q=` and `/?source=` redirect here (see app/page.tsx). */
export const SEARCH_PATH = "/search";
export const EXAMPLES = ["unemployment rate India", "CPI inflation", "policy rate", "GDP", "exports to USA", "population"];
/** Link to /search from plain key/value params (empty values dropped). */
export const searchHref = (p: Record<string, string | undefined>) => {
  const u = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]);
  return u.size ? `${SEARCH_PATH}?${u}` : SEARCH_PATH;
};
export const filtersHref = (f: Filters, path = SEARCH_PATH) => {
  const p = filtersToParams(f);
  return p.size ? `${path}?${p}` : path;
};
export const hasFilters = (f: Filters) => Object.entries(f).some(([k, v]) => k !== "q" && (Array.isArray(v) ? v.length : v));

/** URLSearchParams (client side) -> RawParams, keeping repeated keys. */
export const toRaw = (p: URLSearchParams): RawParams => {
  const o: Record<string, string[]> = {};
  p.forEach((v, k) => (o[k] ??= []).push(v));
  return o;
};

export type ChipKey = "geo" | "freq" | "source" | "topic" | "start_year" | "end_year" | "updated_since" | "redistribute";
/** The filters minus one value (or the whole key when `value` is omitted). */
export function without(f: Filters, key: ChipKey, value?: string): Filters {
  const g = { ...f };
  if (key === "source" || key === "topic") g[key] = value ? f[key].filter((x) => x !== value) : [];
  else g[key] = undefined;
  return g;
}

/** "Updated" presets are plain dates in the URL so the API can take them as they are. */
export const UPDATED_OPTIONS = [{ id: "", label: "Any time" }, { id: "30d", label: "Last 30 days" }, { id: "1y", label: "Last year" }] as const;
export function sinceDate(preset: string, now = new Date()): string | undefined {
  const d = new Date(now);
  if (preset === "30d") d.setUTCDate(d.getUTCDate() - 30);
  else if (preset === "1y") d.setUTCFullYear(d.getUTCFullYear() - 1);
  else return undefined;
  return d.toISOString().slice(0, 10);
}
/** Which preset a stored date corresponds to ("" when none or custom). */
export const updatedPreset = (iso?: string, now = new Date()) => (iso ? (["30d", "1y"].find((p) => sinceDate(p, now) === iso) ?? "custom") : "");

// --- query understanding ---------------------------------------------------------------------------
const STOP = new Set("a an the of in on for to and or by with from since at is are was what how show me give data statistics stats".split(" "));
export type Understood = { terms: string[]; geo?: { code: string; name: string } };
/** Split a question into search terms and spot a country by name (longest name first, whole words). */
export function understandQuery(q: string, geos: Map<string, string>): Understood {
  let rest = ` ${q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ")} `;
  let geo: Understood["geo"];
  for (const [code, name] of [...geos].sort((a, b) => b[1].length - a[1].length)) {
    const n = ` ${name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim()} `;
    if (n.trim().length > 2 && rest.includes(n)) { geo = { code, name }; rest = rest.replace(n, " "); break; }
  }
  return { terms: rest.split(/\s+/).filter((w) => w && !STOP.has(w)), geo };
}

// --- sources page ---------------------------------------------------------------------------------
export type SourceFilters = { q: string; kind: string[]; topic: string[]; redistribute: string[]; access: string[]; status: string[] };
export const ACCESS = [{ id: "keyless", label: "No key needed" }, { id: "key_set", label: "Needs key (configured)" }, { id: "key_missing", label: "Needs key (not configured)" }] as const;
export const STATUS = [{ id: "data", label: "Has data" }, { id: "catalogue", label: "Catalogue only" }] as const;
export function parseSourceFilters(sp: RawParams): SourceFilters {
  const ids = (xs: readonly { id: string }[], v: string[]) => v.filter((x) => xs.some((o) => o.id === x));
  return {
    q: (first(sp.q) ?? "").trim(), kind: all(sp.kind), topic: all(sp.topic).filter((t) => (TOPICS as readonly string[]).includes(t)),
    redistribute: all(sp.redistribute).filter((r) => (REDISTRIBUTE as readonly string[]).includes(r)),
    access: ids(ACCESS, all(sp.access)), status: ids(STATUS, all(sp.status)),
  };
}
export const sourceFiltersHref = (f: SourceFilters) => {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const k of ["kind", "topic", "redistribute", "access", "status"] as const) f[k].forEach((v) => p.append(k, v));
  return p.size ? `/sources?${p}` : "/sources";
};
/** Toggle one value of one chip group. */
export const toggleSource = (f: SourceFilters, k: Exclude<keyof SourceFilters, "q">, v: string): SourceFilters =>
  ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });

type Src = { id: string; name: string; kind: string; auth: string; key_configured: boolean; redistribute: string; series: number; last_ingested_at: string | null; topics?: string[]; description?: string };
/** Within a group: any of the picked values. Across groups: all. */
/** What /sources can take directly; groups it cannot express (several values, key set vs missing) are applied by filterSources. */
export function sourcesApiParams(f: SourceFilters) {
  const one = (v: string[]) => (v.length === 1 ? v[0] : undefined);
  const auth = f.access.length && f.access.every((a) => a === "keyless") ? "keyless" : f.access.length && f.access.every((a) => a !== "keyless") ? "key" : undefined;
  return { q: f.q || undefined, kind: one(f.kind), topic: f.topic, redistribute: one(f.redistribute), auth, status: one(f.status) };
}

/** True when the API would get no filter at all, so the cached unfiltered list is the answer. */
export const noApiFilter = (a: ReturnType<typeof sourcesApiParams>) => Object.values(a).every((v) => (Array.isArray(v) ? !v.length : !v));

export function filterSources<T extends Src>(rows: T[], f: SourceFilters): T[] {
  const q = f.q.toLowerCase();
  return rows.filter((s) => {
    const loaded = s.series > 0 && !!s.last_ingested_at;
    const access = s.auth === "none" ? "keyless" : s.key_configured ? "key_set" : "key_missing";
    return (!q || `${s.id} ${s.name} ${s.description ?? ""}`.toLowerCase().includes(q)) &&
      (!f.kind.length || f.kind.includes(s.kind)) &&
      (!f.topic.length || (s.topics ?? []).some((t) => f.topic.includes(t))) &&
      (!f.redistribute.length || f.redistribute.includes(s.redistribute)) &&
      (!f.access.length || f.access.includes(access)) &&
      (!f.status.length || f.status.includes(loaded ? "data" : "catalogue"));
  });
}
