// Pure number extraction and "is this number in any tool result?" check. No React, no I/O.

export type ExtractedNumber = {
  raw: string;
  /** Value with scale words applied ("3.2 billion" -> 3.2e9). Percent keeps its face value (5.2% -> 5.2). */
  value: number;
  /** Half a unit of the last displayed digit, scaled: how far a rounded figure may sit from its source. */
  tol: number;
  start: number;
  end: number;
  percent: boolean;
  /** True for a bare integer (no decimals, separators, percent or scale word). */
  plain: boolean;
};

const SCALE: Record<string, number> = {
  thousand: 1e3, k: 1e3,
  million: 1e6, m: 1e6, mn: 1e6,
  billion: 1e9, bn: 1e9, b: 1e9,
  trillion: 1e12, tn: 1e12, t: 1e12,
};
// Attached abbreviations (3.2bn) or spaced words (3.2 billion), then percent forms.
// A currency code glued to the number ("USD9.9", "Rs9,999") still counts as a figure.
const NUM = /(?:(?<![\w.])|(?<=\b(?:USD|INR|EUR|GBP|JPY|CNY|CAD|AUD|CHF|US|Rs)))(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(%|percent\b|per cent\b)|\s(thousand|million|billion|trillion)\b|(k|mn|m|bn|b|tn|t)\b)?(?![\w])/gi;

/** Blank out code (SQL, ids in backticks) and list numbering so they are not read as claims. */
function mask(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/^(\s*)(\d+)([.)])(?=\s)/gm, (_m, a: string, d: string, p: string) => a + " ".repeat(d.length + p.length));
}

export function extractNumbers(text: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  for (const m of mask(text).matchAll(NUM)) {
    const [raw, int, frac, pct, word, abbr] = m;
    const digits = int.replace(/,/g, "");
    const scale = SCALE[(word ?? abbr ?? "").toLowerCase()] ?? 1;
    const base = Number(frac ? `${digits}.${frac}` : digits);
    let tol = 0.5 * 10 ** -(frac?.length ?? 0) * scale;
    // "5,400" or "12000": trailing zeros of a big integer mean rounding, not precision.
    if (!frac && scale === 1 && !pct && base >= 1000) tol = 0.5 * 10 ** (digits.length - digits.replace(/0+$/, "").length);
    out.push({
      raw, value: base * scale, tol, start: m.index, end: m.index + raw.length,
      percent: !!pct, plain: !frac && !pct && scale === 1 && !int.includes(","),
    });
  }
  return out;
}

/** Collect every number in a JSON-ish value: numeric leaves, and numbers inside strings (dates, ids). */
export function collectNumbers(v: unknown, into: number[] = []): number[] {
  if (typeof v === "number" && Number.isFinite(v)) into.push(Math.abs(v));
  // ISO dates keep only the year: their month/day digits must not whitelist 1, 100, 1000... through MULTS.
  else if (typeof v === "string") for (const n of extractNumbers(v.replace(/\b(\d{4})-\d{2}-\d{2}\b/g, "$1"))) into.push(n.value);
  else if (Array.isArray(v)) for (const x of v) collectNumbers(x, into);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectNumbers(x, into);
  return into;
}

// A figure may be quoted in other scales than the data ("3.2 billion" for 3200 million) or as a ratio of a percent.
const MULTS = [1, 1e3, 1e6, 1e9, 1e12, 100, 0.01];

export type Flagged = { start: number; end: number; raw: string };

/**
 * Numbers in replyText that appear in no tool result (nor in the user's own question).
 * Ignored: code spans, list numbering, tokens glued to letters (G20, 3D, ids), and bare integers 0..10.
 * ponytail: bare small integers ("3 series") are never flagged; derived figures (sums, growth) are flagged.
 */
export function flagUnsourcedNumbers(replyText: string, toolResults: unknown[], userText = ""): Flagged[] {
  const sources = collectNumbers(toolResults);
  collectNumbers(userText, sources);
  const found = (n: ExtractedNumber) => {
    if (n.plain && n.value <= 10) return true;
    return sources.some((s) =>
      MULTS.some((k) => Math.abs(n.value - s * k) < n.tol - 1e-9 * Math.abs(n.value)),
    );
  };
  return extractNumbers(replyText)
    .filter((n) => !found(n))
    .map(({ start, end, raw }) => ({ start, end, raw }));
}
