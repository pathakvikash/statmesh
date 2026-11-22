// The model does not need provenance columns or thousands of rows to answer: it gets a trimmed
// get_observations result, while the UI keeps the full one (see the route).
import { unwrapToolOutput } from "./events";

export const MODEL_ROWS = 60;

// Not unit_mult: the real value is value * 10**unit_mult, so the model must keep it.
const DROP = new Set(["series_id", "source_id", "dataset_id", "indicator_id"]);
const TIME_COLUMNS = ["period_start", "period_end", "period", "date", "time"];

type Rec = Record<string, unknown>;

/**
 * Same reference when nothing changes. Drops id columns and keeps the latest rows: rows arrive ordered by geo
 * then period, so with several geos each keeps its own latest ceil(max / geos) rows instead of the last
 * countries alphabetically starving the rest. Says how many were omitted.
 */
export function trimForModel(output: unknown, max = MODEL_ROWS): unknown {
  const o = output && typeof output === "object" && !Array.isArray(output) ? (output as Rec) : undefined;
  if (!o || !Array.isArray(o.columns) || !Array.isArray(o.rows)) return output;
  const columns = o.columns.map(String);
  const keepCol = columns.map((c) => !DROP.has(c));
  if (keepCol.every(Boolean) && o.rows.length <= max) return output;
  if (!keepCol.some(Boolean)) keepCol.fill(true);
  const all = o.rows as unknown[][];
  const it = TIME_COLUMNS.map((c) => columns.indexOf(c)).find((i) => i >= 0) ?? -1;
  const ig = columns.indexOf("geo");

  let kept = all.map((_, i) => i);
  let quota = max;
  if (all.length > max) {
    const groups = new Map<string, number[]>();
    all.forEach((r, i) => {
      const k = ig >= 0 ? String(r[ig]) : "";
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    quota = Math.ceil(max / groups.size);
    const keep = new Set<number>();
    for (const idx of groups.values()) {
      const byTime = it >= 0 ? [...idx].sort((a, b) => (String(all[a][it]) < String(all[b][it]) ? -1 : String(all[a][it]) > String(all[b][it]) ? 1 : a - b)) : idx;
      for (const i of byTime.slice(-quota)) keep.add(i);
    }
    kept = kept.filter((i) => keep.has(i));
  }
  const omitted = all.length - kept.length;
  return {
    ...o,
    columns: columns.filter((_, i) => keepCol[i]),
    rows: kept.map((i) => all[i].filter((_, j) => keepCol[j])),
    ...(omitted ? { omitted_rows: omitted, note: `Older rows omitted per geo (${omitted} omitted, latest ${quota} kept); ask for a narrower range if needed.` } : {}),
  };
}

type AnyTool = { execute?: (i: never, o: never) => unknown } & Record<string, unknown>;

/**
 * get_observations is big and mostly provenance: the model gets a trimmed copy, the UI keeps the full result.
 * Normal path: toModelOutput. CLI path (toModelOutput is lost through MCP): execute returns the trimmed copy plus
 * a fullRef, which restoreFull swaps back for the UI.
 */
export function leanForModel<T extends Record<string, unknown>>(tools: T, cli: boolean, fulls: Map<string, unknown>): T {
  const t = tools.get_observations as AnyTool | undefined;
  const run = t?.execute;
  if (!t || !run) return tools;
  const lean: AnyTool = cli
    ? {
        ...t,
        execute: async (i: never, o: never) => {
          const out = unwrapToolOutput(await run(i, o));
          const trimmed = trimForModel(out);
          if (trimmed === out) return out;
          const ref = crypto.randomUUID();
          fulls.set(ref, out);
          return { ...(trimmed as object), fullRef: ref };
        },
      }
    : { ...t, toModelOutput: ({ output }: { output: unknown }) => ({ type: "json", value: trimForModel(unwrapToolOutput(output)) }) };
  return { ...tools, get_observations: lean };
}

/** The full result behind a trimmed one's fullRef, else the output unchanged. */
export function restoreFull(output: unknown, fulls: Map<string, unknown>): unknown {
  const ref = (output as { fullRef?: unknown } | null)?.fullRef;
  return typeof ref === "string" && fulls.has(ref) ? fulls.get(ref) : output;
}
