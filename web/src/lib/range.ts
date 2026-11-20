// Pure time-range preset logic for chart buttons (1Y / 5Y / 10Y / Max). No React, no DOM.
import { periodLabel } from "./format";

export type PresetId = "1Y" | "5Y" | "10Y" | "Max";
export type Preset = { id: PresetId; from: string | null; available: boolean; points: number };
export type RangeState = { presets: Preset[]; active: PresetId; from: string | null };

export const PRESET_IDS: PresetId[] = ["1Y", "5Y", "10Y", "Max"];
const YEARS: Record<PresetId, number> = { "1Y": 1, "5Y": 5, "10Y": 10, Max: 0 };

/** "2024" -> "2024-01-01", "2024-03" -> "2024-03-01", otherwise the first 10 characters. */
export function isoDay(t: string): string {
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  return t.slice(0, 10);
}

/** Distinct ISO days, oldest first (input may be unsorted or repeated). */
export function sortedPeriods(periods: string[]): string[] {
  return [...new Set(periods.filter(Boolean).map(isoDay))].sort();
}

/**
 * One entry per preset. A window is exclusive at its start: it holds the points strictly after
 * `from`, where `from` is the latest period minus N years (so "1Y" of annual data is 1 point).
 * A preset is available only if the data reaches back past `from` (otherwise the window is all
 * of the data, i.e. identical to Max) and the window holds at least 2 points. Max is always available.
 */
export function presets(periods: string[]): Preset[] {
  const ps = sortedPeriods(periods);
  const last = ps.at(-1);
  return PRESET_IDS.map((id): Preset => {
    const years = YEARS[id];
    if (!years) return { id, from: null, available: true, points: ps.length };
    if (!last) return { id, from: null, available: false, points: 0 };
    const [y, m, d] = last.split("-").map(Number);
    const from = new Date(Date.UTC(y - years, m - 1, d)).toISOString().slice(0, 10);
    const points = ps.filter((t) => t > from).length;
    return { id, from, available: ps[0] <= from && points >= 2, points };
  });
}

/** The preset to show: the selected one if still available, otherwise Max. */
export function rangeState(periods: string[], selected: PresetId): RangeState {
  const list = presets(periods);
  const active = list.find((p) => p.id === selected)?.available ? selected : "Max";
  return { presets: list, active, from: list.find((p) => p.id === active)!.from };
}

/** True when a period lies inside a window (from = null means everything). */
export function inWindow(period: string, from: string | null): boolean {
  return from === null || isoDay(period) > from;
}

/** "Jan 2024 to Jun 2024", or a single label when there is one period; "" when empty. */
export function spanText(periods: string[], freq?: string | null): string {
  const ps = sortedPeriods(periods);
  if (!ps.length) return "";
  const a = periodLabel(ps[0], freq), b = periodLabel(ps.at(-1)!, freq);
  return a === b ? a : `${a} to ${b}`;
}

/** "Data: Jan 2024 to Jun 2024 · 6 points"; "" when empty. */
export function coverageText(periods: string[], freq?: string | null): string {
  const n = sortedPeriods(periods).length;
  if (!n) return "";
  return `Data: ${spanText(periods, freq)} · ${n} ${n === 1 ? "point" : "points"}`;
}

/** Why a disabled preset is disabled, for its tooltip. */
export function unavailableReason(p: Preset, periods: string[], freq?: string | null): string {
  const ps = sortedPeriods(periods);
  if (!ps.length) return "No data";
  if (p.from !== null && ps[0] > p.from) return `Data only covers ${spanText(periods, freq)}`;
  return `Only ${p.points} ${p.points === 1 ? "point" : "points"} in the ${p.id} window; need at least 2`;
}

/** "You asked 2010–2025; data covers 2024 only" when the data is narrower than the asked years (day ends), else "". */
export function coverageGap(asked: { start?: string; end?: string }, periods: string[]): string {
  const ps = sortedPeriods(periods);
  if (!ps.length || (!asked.start && !asked.end)) return "";
  const y = (s: string) => Number(s.slice(0, 4));
  const [a, b] = [y(ps[0]), y(ps.at(-1)!)];
  const s = asked.start ? y(asked.start) : undefined, e = asked.end ? y(asked.end) : undefined;
  if (!((s !== undefined && a > s) || (e !== undefined && b < e))) return "";
  const want = s !== undefined && e !== undefined ? (s === e ? `${s}` : `${s}–${e}`) : s !== undefined ? `${s} onward` : `up to ${e}`;
  return `You asked ${want}; data covers ${a === b ? `${a} only` : `${a}–${b}`}`;
}
