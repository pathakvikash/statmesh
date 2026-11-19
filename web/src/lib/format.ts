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
export const seriesHref = (id: string) => `/series/${id.split("/").map(encodeURIComponent).join("/")}`;
