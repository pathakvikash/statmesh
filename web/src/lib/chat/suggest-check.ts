// search_series hits can be catalogue entries with no stored observations (e.g. WHO tobacco indicators).
// The model gets a `has_data` hint per hit so it never offers an empty series as an answer.
import { unwrapToolOutput } from "./events";
import { keyMatchSql } from "../multigeo";
import { sqlList } from "../sql";

export type HasData = boolean | "unknown";
/** Ids that have at least one stored value, among the asked ids. May reject. */
export type DataLayer = (ids: string[]) => Promise<Set<string>>;

export const MAX_CHECK = 10;
export const CHECK_MS = 2000;
export const NO_DATA_NOTE = "None of these series has stored data. Say they are empty; do not offer them as answers.";

type Rec = Record<string, unknown>;
const idOf = (h: unknown): string | undefined => {
  const r = h as Rec | null;
  const v = r && typeof r === "object" ? (r.series_id ?? r.series_key ?? r.id) : undefined;
  return typeof v === "string" ? v : undefined;
};

/** One bounded SQL over observations; 3-part keys match their `key:geo` rows. */
export function sqlDataLayer(run: (q: string) => Promise<{ rows: unknown[][] }>): DataLayer {
  return async (ids) => {
    const keys = ids.filter((i) => i.split(":").length === 3);
    const where = [`series_id IN (${sqlList(ids)})`, ...(keys.length ? [keyMatchSql("series_id", keys)] : [])].join(" OR ");
    const r = await run(`SELECT DISTINCT series_id FROM observations WHERE value IS NOT NULL AND (${where})`);
    const got = r.rows.map((x) => String(x[0]));
    return new Set(ids.filter((i) => got.some((g) => g === i || g.startsWith(`${i}:`))));
  };
}

/** Adds has_data to each hit (first MAX_CHECK get a check, the rest "unknown"); never throws. */
export async function annotateHits(output: unknown, layer: DataLayer, ms = CHECK_MS): Promise<unknown> {
  const o = output as Rec | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.hits) || !o.hits.length) return output;
  const ids = [...new Set(o.hits.slice(0, MAX_CHECK).map(idOf).filter((x): x is string => !!x))];
  let have: Set<string> | undefined;
  if (ids.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      have = await Promise.race([layer(ids), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), ms); })]);
    } catch {
      have = undefined;
    } finally {
      clearTimeout(timer);
    }
  }
  const checked = new Set(ids);
  const hits = o.hits.map((h) => {
    const id = idOf(h);
    const has_data: HasData = !have || !id || !checked.has(id) ? "unknown" : have.has(id);
    return h && typeof h === "object" ? { ...(h as Rec), has_data } : h;
  });
  const allFalse = hits.every((h) => (h as Rec | null)?.has_data === false);
  return { ...o, hits, ...(allFalse ? { no_data_note: NO_DATA_NOTE } : {}) };
}

type AnyTool = { execute?: (i: never, o: never) => unknown } & Record<string, unknown>;

/** Wraps search_series.execute; other tools and the input schema are untouched. */
export function withHasData<T extends Record<string, unknown>>(tools: T, layer: DataLayer): T {
  const t = tools.search_series as AnyTool | undefined;
  const run = t?.execute;
  if (!t || !run) return tools;
  return { ...tools, search_series: { ...t, execute: async (i: never, o: never) => annotateHits(unwrapToolOutput(await run(i, o)), layer) } };
}
