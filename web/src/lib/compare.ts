// Pure logic for "Compare with...": suggestions, URL params, axis rules, index, annual alignment, overlap, CSV.
// No React and no server imports, so the client and the tests can use it.
import { isMultiGeoKey } from "./multigeo";
import { toCsv } from "./sql-csv";

export const MAX_SERIES = 3;
export const MAX_GEOS = 4;

// --- URL params ---------------------------------------------------------------------------------------
const ID_RE = /^[\w.-]+:[\w.-]+:[\w.-]+$/;

/** `compare=a,b,c`: 3-part series ids only, self and duplicates dropped, at most 3 kept. */
export function parseCompareParam(raw: string | undefined, self: string) {
  const ids: string[] = [], rejected: string[] = [];
  for (const part of [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))]) {
    if (part === self) continue;
    if (ID_RE.test(part) && isMultiGeoKey(part)) ids.push(part);
    else rejected.push(part);
  }
  return { ids: ids.slice(0, MAX_SERIES), tooMany: ids.length > MAX_SERIES, rejected };
}

/** `geo=IND,USA`: only codes that exist for the series, at most 4; falls back to the default when none are valid. */
export function parseGeoParam(raw: string | undefined, available: string[], fallback: string[]): string[] {
  const ok = new Set(available);
  const picked = [...new Set((raw ?? "").split(",").map((s) => s.trim()).filter((g) => ok.has(g)))].slice(0, MAX_GEOS);
  if (picked.length) return picked;
  return fallback.filter((g) => ok.has(g)).slice(0, MAX_GEOS);
}

// --- suggestions --------------------------------------------------------------------------------------
export type Companion = { label: string; query: string; match: RegExp; note?: string };
type Rule = { concept: RegExp; companions: Companion[] };

const GDP: Companion = { label: "GDP", query: "gross domestic product", match: /\bgdp\b|gross domestic product/i };
const UNEMPLOYMENT: Companion = { label: "Unemployment", query: "unemployment rate", match: /unemployment/i };
const INFLATION: Companion = { label: "Inflation", query: "inflation", match: /inflation|consumer price/i };
const POPULATION: Companion = { label: "Population", query: "population", match: /population/i };

// Concepts found in a series title, and the series a reader most likely wants next to them.
const RULES: Rule[] = [
  { concept: /life expectancy/i, companions: [
    { label: "Fertility rate", query: "total fertility rate", match: /fertility/i,
      note: "No crude birth-rate series is loaded; closest: total fertility rate." },
    { label: "Infant mortality", query: "infant mortality", match: /infant mortality/i },
    { label: "Child mortality", query: "child mortality", match: /child mortality/i },
    POPULATION,
  ] },
  { concept: /fertility|birth/i, companions: [
    { label: "Life expectancy", query: "life expectancy", match: /life expectancy/i },
    { label: "Infant mortality", query: "infant mortality", match: /infant mortality/i },
  ] },
  { concept: /\bgdp\b|gross domestic product/i, companions: [POPULATION, UNEMPLOYMENT, INFLATION] },
  { concept: /inflation|consumer price/i, companions: [
    { label: "Policy rate", query: "policy rate", match: /policy rate|interest rate/i }, UNEMPLOYMENT,
  ] },
  { concept: /unemployment/i, companions: [GDP, INFLATION] },
  { concept: /\bco2\b|emission/i, companions: [
    { label: "Energy use", query: "energy use", match: /energy/i }, GDP,
  ] },
];

/** Likely companions for a series title, without duplicates or the title's own concept. */
export function suggestionsFor(title: string): Companion[] {
  const seen = new Set<string>(), out: Companion[] = [];
  for (const rule of RULES) {
    if (!rule.concept.test(title)) continue;
    for (const c of rule.companions) {
      if (seen.has(c.label) || c.match.test(title)) continue;
      seen.add(c.label);
      out.push(c);
    }
  }
  return out;
}

/**
 * The first search hit (within `limit` candidates) that matches the companion, is a 3-part key, is not excluded
 * and passes `hasData`. A catalogue entry without observations is skipped, so the next match is tried.
 */
export async function resolveCompanion<H extends { id: string; title: string }>(
  c: Companion, hits: H[], exclude: string[], hasData: (id: string) => Promise<boolean>, limit = 4,
): Promise<H | undefined> {
  const skip = new Set(exclude);
  const candidates = hits.filter((h) => c.match.test(h.title) && isMultiGeoKey(h.id) && !skip.has(h.id)).slice(0, limit);
  for (const h of candidates) if (await hasData(h.id)) return h;
  return undefined;
}

// --- axes and units -----------------------------------------------------------------------------------
export type Mode = "single" | "dual" | "index";

/** One distinct unit: one axis. Two: left and right. More than two: index. */
export function axisMode(units: string[]): Mode {
  const n = new Set(units).size;
  return n <= 1 ? "single" : n === 2 ? "dual" : "index";
}

// --- data ----------------------------------------------------------------------------------------------
export type Point = { t: string; v: number };
export type Line = { key: string; label: string; unit: string; freq: string | null; points: Point[] };
export type Row = Record<string, number | string>; // { t: "2020-01-01", s0|IND: 5.1 }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const yearOf = (t: string) => t.slice(0, 4);

/**
 * Wide rows on one period axis. When the lines have more than one frequency, every line is averaged per
 * calendar year (aligned = true); otherwise periods are kept as they are.
 */
export function alignLines(lines: Line[]): { rows: Row[]; aligned: boolean; freq: string | null } {
  const freqs = [...new Set(lines.map((l) => l.freq ?? ""))];
  const aligned = freqs.length > 1;
  const by = new Map<string, Row>();
  for (const l of lines) {
    const groups = new Map<string, number[]>();
    for (const p of l.points) {
      if (!Number.isFinite(p.v)) continue;
      const t = aligned ? yearOf(p.t) : p.t;
      groups.set(t, [...(groups.get(t) ?? []), p.v]);
    }
    for (const [t, vs] of groups) by.set(t, { ...(by.get(t) ?? { t }), [l.key]: mean(vs) });
  }
  const rows = [...by.values()].sort((a, b) => String(a.t).localeCompare(String(b.t)));
  return { rows, aligned, freq: aligned ? "A" : freqs[0] || null };
}

/** True when some period holds values for at least two lines (one line can always be drawn). */
export function overlaps(rows: Row[], keys: string[]): boolean {
  if (keys.length < 2) return rows.length > 0;
  return rows.some((r) => keys.filter((k) => typeof r[k] === "number").length >= 2);
}

/** "These series do not overlap in time: A covers 1990-2000, B covers 2010-2020." */
export function noOverlapMessage(lines: Line[]): string {
  const parts = lines.filter((l) => l.points.length).map((l) => {
    const ts = l.points.map((p) => p.t).sort();
    const a = yearOf(ts[0]), b = yearOf(ts.at(-1)!);
    return `${l.label} covers ${a === b ? a : `${a}–${b}`}`;
  });
  return `These series do not overlap in time: ${parts.join(", ")}.`;
}

/**
 * Index = 100 at the first period where every line has a value. A line whose base is zero, null or not finite
 * cannot be indexed and is listed in `dropped` instead of dividing by zero.
 */
export function indexRows(rows: Row[], keys: string[]): { rows: Row[]; base: string | null; dropped: string[] } {
  const common = rows.find((r) => keys.every((k) => typeof r[k] === "number"));
  if (!common) return { rows: [], base: null, dropped: [] };
  const dropped = keys.filter((k) => { const b = common[k] as number; return !Number.isFinite(b) || b === 0; });
  const use = keys.filter((k) => !dropped.includes(k));
  return {
    base: String(common.t),
    dropped,
    rows: rows.map((r) => {
      const o: Row = { t: r.t };
      for (const k of use) if (typeof r[k] === "number") o[k] = ((r[k] as number) / (common[k] as number)) * 100;
      return o;
    }),
  };
}

export type Built =
  | { status: "empty" }
  | { status: "no-overlap"; message: string }
  | { status: "no-index"; message: string }
  | {
      status: "ok"; rows: Row[]; keys: string[]; mode: Mode; indexed: boolean; aligned: boolean; freq: string | null;
      units: string[]; axis: Record<string, "left" | "right">; base: string | null; dropped: string[];
    };

/** Everything the compare chart draws, from the lines of all (series, country) pairs. `asIndex` is the toggle. */
export function buildCompare(lines: Line[], asIndex = false): Built {
  if (!lines.length) return { status: "empty" };
  const keys = lines.map((l) => l.key);
  const { rows, aligned, freq } = alignLines(lines);
  if (!overlaps(rows, keys)) return { status: "no-overlap", message: noOverlapMessage(lines) };
  const units = [...new Set(lines.map((l) => l.unit))];
  const mode = axisMode(units);
  const indexed = mode === "index" || asIndex;
  if (indexed) {
    const ix = indexRows(rows, keys);
    if (!ix.base) {
      return { status: "no-index", message: "Index needs a period where every line has a value, and these lines share none. Remove a series or pick ones that overlap." };
    }
    return {
      status: "ok", rows: ix.rows, keys: keys.filter((k) => !ix.dropped.includes(k)), mode, indexed, aligned, freq, units,
      axis: Object.fromEntries(keys.map((k) => [k, "left" as const])), base: ix.base, dropped: ix.dropped,
    };
  }
  const axis = Object.fromEntries(lines.map((l) => [l.key, mode === "dual" && l.unit === units[1] ? "right" as const : "left" as const]));
  return { status: "ok", rows, keys, mode, indexed: false, aligned, freq, units, axis, base: null, dropped: [] };
}

/** The drawn table as CSV: a period column, then one column per line label. */
export function compareCsv(rows: Row[], keys: string[], labels: string[]): string {
  return toCsv(["period", ...labels], rows.map((r) => [r.t, ...keys.map((k) => r[k] ?? "")]));
}
