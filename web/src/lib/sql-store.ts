export const RECENT_MAX = 20;
export type SavedQuery = { name: string; sql: string };

const RECENT = "statmesh.sql.recent";
const SAVED = "statmesh.sql.saved";

/** Newest first, no duplicates, capped. */
export const pushRecent = (list: string[], sql: string): string[] =>
  [sql, ...list.filter((s) => s !== sql)].slice(0, RECENT_MAX);

function read<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}
export const loadRecent = () => read<string>(RECENT);
export const saveRecent = (l: string[]) => write(RECENT, l);
export const loadSaved = () => read<SavedQuery>(SAVED);
export const saveSaved = (l: SavedQuery[]) => write(SAVED, l);

/** The chat page keeps its provider config here; the SQL page only reads it. */
export function loadChatConfig(): Record<string, string> | null {
  try {
    const c = JSON.parse(localStorage.getItem("statmesh.chat.settings") ?? "null");
    return c?.model && (c.apiKey || c.kind === "ollama") ? c : null;
  } catch {
    return null;
  }
}
