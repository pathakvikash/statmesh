/** SQL string literal: single quotes doubled. The only way user-influenced text may enter generated SQL. */
export const sqlLiteral = (s: string): string => `'${s.replaceAll("'", "''").replaceAll("\0", "")}'`;
export const sqlList = (xs: string[]): string => xs.map(sqlLiteral).join(", ");

const LEAD = /^(?:\s+|;|\/\*[\s\S]*?\*\/)+/;
const STARTS = /^(?:(?:select|with|values|summarize|describe)\b|\(|--)/i;
// "from observations" is SQL; "From 2015, unemployment..." is a question. A table name, not a digit or common word.
const FROM = /^from\s+(?:"?[a-z_][\w]*"?)(?:\s|;|$)/i;
const WORDS = new Set(["the", "a", "an", "my", "your", "our", "this", "that", "these", "those", "now", "then", "there", "here", "india", "all", "each", "every", "some", "any", "which", "what", "when", "how", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "last", "next", "early", "late"]);

/** True when the text already looks like SQL; anything else is treated as a plain-language question. */
export function looksLikeSql(text: string): boolean {
  const t = text.replace(LEAD, "");
  if (STARTS.test(t)) return true;
  const m = FROM.exec(t);
  return !!m && !WORDS.has(t.split(/\s+/)[1].replace(/["';]/g, "").toLowerCase());
}

/** Source ids to suggest right after `source_id = '` or inside `source_id IN ('a', '`. `from` is the offset in `before`. */
export function valueCompletions(before: string, sources: string[]): { from: number; options: string[] } | null {
  const m = /\bsource_id\s*(?:=\s*|\bIN\s*\((?:[^()]*,)?\s*)'([^']*)$/i.exec(before);
  if (!m) return null;
  const partial = m[1].toLowerCase();
  const options = sources.filter((s) => s.toLowerCase().startsWith(partial));
  return options.length ? { from: before.length - m[1].length, options } : null;
}

/** A model's SQL reply: code fences stripped, at most 4000 characters. */
export const cleanReply = (text: string): string => text.replace(/^```\w*\n?|```\s*$/g, "").trim().slice(0, 4000);
