import { z } from "zod";

/**
 * Page context for the AI assistant: a few plain strings describing what the user is looking at.
 * Never settings, keys or cookies. Pure apart from the small SQL-text store at the bottom.
 */
export const CONTEXT_MAX_CHARS = 2000;
export const SQL_CONTEXT_MAX = 1200;
export const SQL_LINK_MAX = 4000;
const MAX_FILTERS = 8;

export type Filters = Record<string, string>;
export type PageContext =
  | { kind: "series"; seriesId: string; title?: string; geos?: string; dims?: string; range?: string; freq?: string }
  | { kind: "search"; query?: string; filters?: Filters }
  | { kind: "sql"; sql?: string }
  | { kind: "sources"; filters?: Filters }
  | { kind: "home" };

const trim = (s: string | null | undefined, n: number) => {
  const t = s?.trim();
  return t ? t.slice(0, n) : undefined;
};

function filtersOf(p: URLSearchParams, skip: string[] = []): Filters | undefined {
  const out: Filters = {};
  for (const [k, v] of p) {
    if (skip.includes(k) || Object.keys(out).length >= MAX_FILTERS) continue;
    const key = trim(k, 40);
    const val = trim(v, 80);
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}

/** Builds the context from the URL (pathname + search) and a couple of facts read from the page. */
export function buildPageContext(pathname: string, search: string, opts: { title?: string | null; sql?: string | null } = {}): PageContext {
  const p = new URLSearchParams(search);
  const path = pathname.replace(/\/+$/, "") || "/";
  const series = /^\/series\/([^/]+)$/.exec(path);
  if (series) {
    const id = trim(safeDecode(series[1]), 200);
    if (id) {
      const range = trim(p.get("range"), 100) ?? trim([p.get("from"), p.get("to")].filter(Boolean).join("-"), 100);
      return {
        kind: "series",
        seriesId: id,
        title: trim(opts.title, 200),
        geos: trim(p.get("geos") ?? p.get("geo"), 200),
        dims: trim(p.get("dims"), 200),
        range,
        freq: trim(p.get("freq"), 20),
      };
    }
  }
  if (path === "/" && p.get("q") !== null) return { kind: "search", query: trim(p.get("q"), 300), filters: filtersOf(p, ["q"]) };
  const src = /^\/sources\/([^/]+)$/.exec(path);
  const srcId = src && trim(safeDecode(src[1]), 80);
  if (srcId) return { kind: "sources", filters: { source: srcId } };
  if (path === "/sources") return { kind: "sources", filters: filtersOf(p) };
  if (path === "/sql") return { kind: "sql", sql: trim(opts.sql, SQL_CONTEXT_MAX) };
  return { kind: "home" };
}

export type QuickPrompt = { label: string; text: string; fill?: boolean };

/** Chips for an empty conversation. `fill` puts the text in the composer (for prompts that need the user to finish them). */
export function quickPrompts(c: PageContext): QuickPrompt[] {
  const say = (text: string, fill = false): QuickPrompt => ({ label: fill ? `${text}...` : text, text, fill });
  switch (c.kind) {
    case "series":
      return [say("Explain this chart"), say("What changed the most?"), say("What are the caveats of this data?"), say("Write SQL to compare the top 5 countries")];
    case "search":
      return [say(c.query ? `Which of these is best for ${c.query}?` : "Which of these is best for my question?"), say("Summarise these results")];
    case "sql":
      return [say("Explain this query"), say("Fix my query"), say("Write a query for ", true)];
    case "sources":
      return [say("What can I ask about these sources?")];
    default:
      return [say("What can I ask here?")];
  }
}

/** Link to the SQL workbench that opens the query and runs it once. Null when the SQL is empty or over the cap. */
export function sqlWorkbenchHref(sql: string): string | null {
  const t = sql.trim();
  if (!t || t.length > SQL_LINK_MAX) return null;
  return `/sql?sql=${encodeURIComponent(t)}&run=1`;
}

/** Bodies of ```sql fenced blocks in an answer's text. */
export function fencedSql(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/```sql[ \t]*\n([\s\S]*?)```/gi)) {
    const s = m[1].trim();
    if (s) out.push(s);
  }
  return out;
}

/** Zod schema for the request body. Strict: unknown keys are rejected. */
const filtersSchema = z.record(z.string().max(40), z.string().max(80)).refine((o) => Object.keys(o).length <= MAX_FILTERS, "Too many filters");
export const pageContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("series"),
    seriesId: z.string().min(1).max(200),
    title: z.string().max(200).optional(),
    geos: z.string().max(200).optional(),
    dims: z.string().max(200).optional(),
    range: z.string().max(100).optional(),
    freq: z.string().max(20).optional(),
  }),
  z.strictObject({ kind: z.literal("search"), query: z.string().max(300).optional(), filters: filtersSchema.optional() }),
  z.strictObject({ kind: z.literal("sql"), sql: z.string().max(SQL_CONTEXT_MAX).optional() }),
  z.strictObject({ kind: z.literal("sources"), filters: filtersSchema.optional() }),
  z.strictObject({ kind: z.literal("home") }),
]);

/** Missing context means home. Oversize or invalid context is an error (the route answers 400). */
export function parsePageContext(raw: unknown): { ok: true; value: PageContext } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: { kind: "home" } };
  if (JSON.stringify(raw).length > CONTEXT_MAX_CHARS) return { ok: false, error: "Page context is too large." };
  const r = pageContextSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: "Invalid page context." };
}

/** The SQL text the workbench is editing, so the assistant can see "this query". Only /sql reads it. */
let sqlText = "";
const listeners = new Set<() => void>();
export const sqlEditorText = {
  get: () => sqlText,
  set(t: string) {
    if (t === sqlText) return;
    sqlText = t;
    listeners.forEach((f) => f());
  },
  subscribe(f: () => void) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};
