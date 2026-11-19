import type { SqlSchema } from "./sql-schema";

export type FriendlyError = { title: string; fix: string; raw: string };

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Closest candidate within a third of the word's length (min 2 edits), or undefined. */
export function didYouMean(word: string, candidates: string[]): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestD = Math.max(2, Math.floor(w.length / 3)) + 1;
  for (const c of new Set(candidates)) {
    const d = levenshtein(w, c.toLowerCase());
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}

const quoted = (s: string) => /["']([^"']+)["']/.exec(s)?.[1];

/** Turn a DuckDB or API error into a title and a fix. Always returns the raw text too. */
export function explainError(raw: string, schema: SqlSchema): FriendlyError {
  const views = schema.views.map((v) => v.name);
  const cols = schema.views.flatMap((v) => v.columns.map((c) => c.name));
  const e = (title: string, fix: string): FriendlyError => ({ title, fix, raw });

  if (/not found in FROM clause|does not have a column named/i.test(raw)) {
    const name = quoted(raw) ?? "";
    // DuckDB often lists its own candidates; the schema is the fallback.
    const cand = /Candidate bindings: "([^"]+)"/.exec(raw)?.[1];
    const guess = didYouMean(name.split(".").pop() ?? name, cols) ?? cand;
    return e(`There is no column called "${name}".`, guess ? `Did you mean "${guess}"? Open a view in the schema browser to see its columns.` : "Open a view in the schema browser to see its columns.");
  }
  if ((/not allowed/i.test(raw) && /table '/.test(raw)) || /Table with name .* does not exist|Catalog Error/i.test(raw)) {
    const name = quoted(raw) ?? "";
    const guess = didYouMean(name, views);
    return e(`There is no table or view called "${name}".`, guess ? `Did you mean "${guess}"? Views you can query: ${views.join(", ")}.` : `Views you can query: ${views.join(", ")}.`);
  }
  if (/function '/.test(raw) || /table function is not allowed/.test(raw) || /is not allowed/.test(raw))
    return e("That statement or function is blocked.", "Reading files, calling table functions and changing settings are not allowed here. Use plain SELECT over the views.");
  if (/single SELECT|exactly one statement/i.test(raw))
    return e("Only one SELECT statement is allowed.", "Remove the extra statements and the semicolons between them. To combine queries, use a WITH clause or UNION ALL.");
  if (/exceeded \d+(\.\d+)?s|timed? ?out/i.test(raw))
    return e("The query took too long and was stopped.", "Add a WHERE filter (source_id, geo, a date range), select fewer columns, or add LIMIT.");
  if (/larger than \d+ bytes|row cap|too many rows/i.test(raw))
    return e("The result is too big.", "Select fewer columns, filter with WHERE, or add LIMIT.");
  if (/syntax error/i.test(raw)) return e("The SQL is not valid.", "Check the spelling of keywords and the commas and brackets near the position named below.");
  return e("The query failed.", "The technical message below says why.");
}
