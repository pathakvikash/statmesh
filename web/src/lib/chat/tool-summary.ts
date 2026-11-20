// Turns a tool call and its result into a status chip, a one-line outcome and the key arguments.
// Shapes follow src/statmesh/core/api_models.py (SearchResult, ObservationsResult, SqlResult).

export type ToolStatus = "running" | "ok" | "no_data" | "failed";
export type ToolSummary = { status: ToolStatus; args: string; outcome: string };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? v : undefined);
const MAX_ARGS = 120;

/** Keys shown in the one-line summary, in order. Free text is always quoted. */
const KEYS: Record<string, string[]> = {
  search_series: ["q", "geo", "source", "topic", "freq", "start_year", "end_year"],
  get_observations: ["series_id", "geo", "start", "end"],
  describe_series: ["series_id"],
  run_sql: ["sql"],
  show_chart: ["title", "series"],
};
const TEXT_KEYS = new Set(["q", "title", "sql"]);

function fmt(key: string, v: unknown): string {
  if (key === "series" && Array.isArray(v)) return `${v.length} series`;
  if (typeof v === "string") return TEXT_KEYS.has(key) || !/^[\w.-]+$/.test(v) ? JSON.stringify(v) : v;
  return JSON.stringify(v);
}

/** `q="robotics", geo=IND, source=datacommons`. Unknown tools fall back to their first three keys. */
export function summarizeArgs(name: string, input: unknown): string {
  const i = rec(input);
  if (!i) return "";
  const keys = KEYS[name] ?? Object.keys(i).slice(0, 3);
  const parts = keys.flatMap((k) => (i[k] === undefined || i[k] === null || i[k] === "" ? [] : [`${k}=${fmt(k, i[k])}`]));
  const s = parts.join(", ");
  return s.length > MAX_ARGS ? s.slice(0, MAX_ARGS - 1) + "…" : s;
}

const rateLimited = (retry: unknown) =>
  typeof retry === "number" && Number.isFinite(retry) ? `rate limited, retry in ${Math.ceil(retry)} s` : "rate limited, try again later";

/** The `error` field of an error object, or the text of a bare string error. */
function errorText(o: unknown): string | undefined {
  const r = rec(o);
  if (r && typeof r.error === "string") return r.error || "The tool failed.";
  if (r && r.error !== undefined && r.error !== null) return "The tool failed.";
  return undefined;
}

function summarizeOutcome(name: string, o: Rec): { status: ToolStatus; outcome: string } {
  const err = errorText(o);
  if (err !== undefined) return { status: "failed", outcome: err };

  if (name === "search_series") {
    const hits = arr(o.hits);
    if (!hits) return { status: "failed", outcome: "unexpected result" };
    if (!hits.length) return { status: "no_data", outcome: "0 results" };
    return { status: "ok", outcome: `${hits.length} results${o.next_offset != null ? " (more available)" : ""}` };
  }

  if (name === "get_observations") {
    switch (o.status) {
      case "rate_limited": return { status: "failed", outcome: rateLimited(o.retry_after) };
      case "forbidden": return { status: "failed", outcome: "forbidden" };
      case "not_found": return { status: "failed", outcome: "not found" };
    }
    const rows = arr(o.rows) ?? [];
    const notes = [o.partial ? "partial result" : "", o.truncated ? "truncated" : ""].filter(Boolean);
    if (!rows.length) return { status: "no_data", outcome: "0 rows" };
    return { status: "ok", outcome: [`${rows.length} rows`, ...notes].join(", ") };
  }

  if (name === "run_sql") {
    const rows = arr(o.rows);
    if (!rows) return { status: "failed", outcome: "unexpected result" };
    if (!rows.length) return { status: "no_data", outcome: "0 rows" };
    return { status: "ok", outcome: `${rows.length} rows${o.truncated ? " (truncated)" : ""}` };
  }

  if (name === "show_chart") {
    if (o.unavailable) return { status: "failed", outcome: "chart no longer available" };
    const series = arr(o.series);
    if (!series) return { status: "failed", outcome: "could not build the chart" };
    const points = series.reduce((n, s) => n + (arr(rec(s)?.points)?.length ?? 0), 0);
    if (!points) return { status: "no_data", outcome: "no data for the chart" };
    return { status: "ok", outcome: `chart: ${series.length} series, ${points} points` };
  }

  return { status: "ok", outcome: "done" };
}

/**
 * `output` is undefined until the result arrives. `pending` is true while the turn is still
 * streaming; a call with no result after the turn ends never finished, so it counts as failed.
 */
export function summarizeTool(name: string, input: unknown, output: unknown, pending: boolean): ToolSummary {
  const args = summarizeArgs(name, input);
  if (output === undefined) {
    return pending
      ? { status: "running", args, outcome: "running" }
      : { status: "failed", args, outcome: "no result (the answer stopped before this finished)" };
  }
  if (Array.isArray(output)) return { status: "ok", args, outcome: "done" };
  const o = rec(output);
  if (!o) {
    return typeof output === "string" ? { status: "ok", args, outcome: "text result" } : { status: "failed", args, outcome: "unexpected result" };
  }
  return { ...summarizeOutcome(name, o), args };
}
