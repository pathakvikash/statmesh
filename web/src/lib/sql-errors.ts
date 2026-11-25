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
    return e(`There is no column called "${name}".`, guess ? `Did you mean "${guess}"? Open a table in the schema browser to see its columns.` : "Open a table in the schema browser to see its columns.");
  }
  if (/Scalar Function|function .* does not exist|Unknown function/i.test(raw)) {
    const name = /function(?: with name)? "?([A-Za-z_][\w]*)"?/i.exec(raw)?.[1] ?? "";
    return e(`There is no function called "${name}".`, "Check the spelling. Common ones are SUM, AVG, MIN, MAX, COUNT, ROUND and STRFTIME. If you passed the wrong kind of value, cast it, for example CAST(value AS DOUBLE).");
  }
  if ((/not allowed/i.test(raw) && /table '/.test(raw)) || /Table with name .* does not exist|Catalog Error/i.test(raw)) {
    const name = quoted(raw) ?? "";
    const guess = didYouMean(name, views);
    return e(`There is no table called "${name}".`, guess ? `Did you mean "${guess}"? Tables you can query: ${views.join(", ")}.` : `Tables you can query: ${views.join(", ")}.`);
  }
  if (/must appear in the GROUP BY|not in GROUP BY|aggregate function/i.test(raw))
    return e("A column is missing from GROUP BY.", "Every column you SELECT must either be in GROUP BY or be wrapped in SUM, AVG, MIN, MAX or COUNT. Add the column to GROUP BY, or aggregate it.");
  if (/Conversion Error|Cannot compare values of type|No function matches the given name and argument types|Could not convert/i.test(raw))
    return e("Two values of different kinds were compared.", "A text value cannot be compared with a date or number. Write dates as '2020-01-01', or use CAST(period_start AS DATE) and CAST(value AS DOUBLE) so both sides match.");
  if (/only (a )?SELECT|must be a SELECT|statement type|not a SELECT|empty query|no statement|single SELECT/i.test(raw))
    return e("Only SELECT is allowed.", "This workbench can read data but not change it. Start your query with SELECT or WITH, and leave out INSERT, UPDATE, DELETE, DROP and similar commands.");
  if (/function '/.test(raw) || /table function is not allowed/.test(raw) || /is not allowed/.test(raw))
    return e("That statement or function is blocked.", "Reading files, calling table functions and changing settings are not allowed here. Use a plain SELECT over the tables.");
  if (/exactly one statement/i.test(raw))
    return e("Only one SELECT statement is allowed.", "Remove the extra statements and the semicolons between them. To combine queries, use a WITH clause or UNION ALL.");
  if (/exceeded \d+(\.\d+)?s|timed? ?out/i.test(raw))
    return e("The query took too long and was stopped.", "Add a WHERE filter (source_id, geo, a date range), select fewer columns, or add LIMIT.");
  if (/larger than \d+ bytes|row cap|too many rows/i.test(raw))
    return e("The result is too big.", "Narrow the years or places with WHERE, select fewer columns, or add LIMIT.");
  if (/syntax error/i.test(raw)) return e("The SQL is not valid.", "Check the spelling of keywords and the commas and brackets near the position named below.");
  return e("The query failed.", "The technical message below says why.");
}

/** Plain-words explanation for a query that returned no rows. */
export function emptyResultHelp(hasGeo: boolean): { message: string; steps: string } {
  return {
    message: "No rows matched. The topic may not cover the place or years you picked. Some topics cover only one country (for example US-only data), so India can return nothing.",
    steps: hasGeo ? "Try removing the place, widening the years, or picking another topic." : "Try widening the years or picking another topic.",
  };
}
