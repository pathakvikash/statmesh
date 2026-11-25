import { SQL_CONTEXT_MAX } from "./ai-context";

export type SqlTab = "ask" | "sql";
type Param = string | string[] | undefined;

/** Beginner tab by default; ?sql= or ?mode=sql (links from chat) or an explicit ?tab=sql open Advanced. */
export function tabFromParams(p: { sql?: Param; mode?: Param; tab?: Param }): SqlTab {
  return p.sql || p.mode === "sql" || p.tab === "sql" ? "sql" : "ask";
}

/** Arrow/Home/End navigation across the two tabs; null when the key is not one of those. */
export function nextTab(key: string, cur: SqlTab): SqlTab | null {
  if (key === "Home") return "ask";
  if (key === "End") return "sql";
  if (key === "ArrowRight" || key === "ArrowLeft") return cur === "ask" ? "sql" : "ask";
  return null;
}

/** Prompt for the free/in-browser assistant: SQL goes in a fenced block the chat can turn into an Open link. */
export const askPrompt = (question: string) =>
  "Write one DuckDB SELECT in a ```sql block, then explain it in two sentences: " + question.trim();

export const explainPrompt = (sql: string) =>
  "Explain this query in plain English, for someone who does not know SQL:\n```sql\n" + sql.trim().slice(0, SQL_CONTEXT_MAX) + "\n```";

/** URL for a tab switch. Advanced keeps sql/run and sets mode=sql; the guided tab drops sql, run, mode and tab. */
export function tabHref(tab: SqlTab, search: string): string {
  const p = new URLSearchParams(search);
  if (tab === "sql") { p.delete("tab"); p.set("mode", "sql"); }
  else for (const k of ["sql", "run", "mode", "tab"]) p.delete(k);
  const q = p.toString();
  return q ? `/sql?${q}` : "/sql";
}
