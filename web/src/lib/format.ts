import type { components } from "./api-types";

export type Citation = components["schemas"]["Citation"];

const MULT: Record<number, string> = { 3: "thousand", 6: "million", 9: "billion", 12: "trillion" };

/** "1,234.5 million USD" — a value never appears without its unit. */
export function formatValue(value: unknown, unit?: string | null, mult?: number | null): string {
  if (value === null || value === undefined) return "n/a";
  const n = typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(value);
  const m = mult ? (MULT[mult] ?? `×10^${mult}`) : "";
  return [n, m, unit].filter(Boolean).join(" ");
}

export function formatPeriod(start?: string | null, end?: string | null): string {
  if (!start) return "n/a";
  return !end || end === start ? start : `${start} to ${end}`;
}

export function citationLine(c: Citation): string {
  const parts = [c.attribution || `Source: ${c.source_name}`, `licence ${c.licence_name}`];
  if (c.retrieved_at) parts.push(`retrieved ${c.retrieved_at.slice(0, 10)}`);
  return parts.join(", ");
}

/** Series ids contain ':' and '/', so encode each path segment. */
/** Only http(s) URLs are rendered as links (a stored `javascript:` or `data:` URL must never become an href). */
export const safeHref = (u?: string | null): string | undefined => (u && /^https?:\/\//i.test(u) ? u : undefined);

export const seriesHref = (id: string) => `/series/${id.split("/").map(encodeURIComponent).join("/")}`;

/** Query params that stay valid when moving between a multi-geo series and one of its countries. */
export const keepQuery = (sp: Record<string, string | undefined>): string => {
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v && (k === "freq" || k.startsWith("dim.")) ? [[k, v]] : [])));
  return q.size ? `?${q}` : "";
};
/** A country's own page: `key:geo`, never `?geo=` (that is Compare mode). */
export const countryHref = (key: string, geo: string, sp: Record<string, string | undefined> = {}) => `${seriesHref(`${key}:${geo}`)}${keepQuery(sp)}`;
/** Back from a country page (4+ parts) to its 3-part parent key. */
export const parentHref = (id: string, sp: Record<string, string | undefined> = {}) => `${seriesHref(id.split(":").slice(0, 3).join(":"))}${keepQuery(sp)}`;

export const FREQ_LABELS: Record<string, string> = {
  A: "Annual", S: "Semiannual", Q: "Quarterly", M: "Monthly", W: "Weekly", D: "Daily",
};
/** Facet options in display order; "" means any. */
export const FREQ_OPTIONS = [
  { value: "", label: "Any" },
  ...["A", "Q", "M", "W", "D"].map((value) => ({ value, label: FREQ_LABELS[value] })),
];
/** "M" -> "Monthly". Unknown codes pass through; null/empty gives null. */
export const freqLabel = (code?: string | null): string | null => (code ? (FREQ_LABELS[code.toUpperCase()] ?? code) : null);

/** "Updated" helper: "today", "3 days ago", "2 months ago". Future or invalid dates give "just now" / "". */
export function relativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** 1_250_000 -> "1.25M". Small numbers keep up to 2 decimals. */
export const formatCompact = (n: number): string =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);

/** Period label by frequency: A "2022", Q "2022 Q3", M "Mar 2022", otherwise the ISO date. */
export function periodLabel(start?: string | null, freq?: string | null): string {
  if (!start) return "n/a";
  const [y, m] = start.split("-");
  const mi = Number(m);
  if (freq === "A") return y;
  if (freq === "Q" && mi) return `${y} Q${Math.ceil(mi / 3)}`;
  if (freq === "M" && mi) return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mi - 1]} ${y}`;
  return start.slice(0, 10);
}

/** Units are often "Percentage" or null; fold in the multiplier ("USD, millions"). */
const UNIT_ALIASES: Record<string, string> = { PT: "%", PERCENT: "%" };
export function unitLabel(unit?: string | null, mult?: number | null): string {
  const m = mult ? (MULT[mult] ?? `×10^${mult}`) : "";
  return [unit && !/^\d+$/.test(unit) ? (UNIT_ALIASES[unit] ?? unit) : "", m].filter(Boolean).join(", ");
}

/** "FRED (Federal Reserve Bank of St. Louis)" -> "FRED". */
export const shortSourceName = (name: string): string => name.replace(/\s*\(.*$/, "").trim() || name;

/** "2015-01-01","2024-12-31" -> "2015–2024"; null when unknown. */
export function coverageYears(start?: string | null, end?: string | null): string {
  const a = start?.slice(0, 4), b = end?.slice(0, 4);
  return !a ? "" : !b || a === b ? a : `${a}–${b}`;
}

/** Source kinds in plain words. */
export const KIND_LABELS: Record<string, string> = {
  sdmx: "Statistics API (SDMX)", file: "File download", custom: "Custom API", ckan: "Open-data portal (CKAN)", socrata: "Open-data portal (Socrata)",
};
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k;
export const REDIST_LABELS: Record<string, string> = { yes: "Redistributable", review: "Check terms", no: "Not redistributable" };
