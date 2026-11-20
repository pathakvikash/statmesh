import { valueLabel } from "./shape";

// Plain words for common SDMX / SDG dimension codes; anything unknown falls back to the raw code.
const SEX: Record<string, string> = { M: "Male", F: "Female", _T: "Total", MF: "Male and female" };
const URB: Record<string, string> = { U: "Urban", R: "Rural", _T: "Total" };
const SEVERITY: Record<string, string> = { _Z: "Not applicable", _U: "Unknown", _X: "Unspecified" };

/** Y15-24 -> "15-24 years", Y_GE65 -> "65 years or over", Y_LT15 -> "Under 15 years", Y5T9 -> "5-9 years". */
function age(code: string): string | undefined {
  let m = /^Y(\d+)[-T](\d+)$/.exec(code);
  if (m) return `${m[1]}-${m[2]} years`;
  if ((m = /^Y_?GE(\d+)$/.exec(code))) return `${m[1]} years or over`;
  if ((m = /^Y_?LT(\d+)$/.exec(code))) return `Under ${m[1]} years`;
  if ((m = /^Y(\d+)$/.exec(code))) return `${m[1]} years`;
}

export function dimensionLabel(dim: string, code: string): string {
  const d = dim.toLowerCase(), c = code.trim();
  const table = /^(sex|gender)$/.test(d) ? SEX : /urban|rural|location|residence/.test(d) ? URB : undefined;
  return table?.[c.toUpperCase()] ?? (/age/.test(d) ? age(c.toUpperCase()) : undefined) ?? SEVERITY[c] ?? valueLabel(code);
}
