// Server-side client: only call from server components and route handlers.
// STATMESH_API_URL is read at runtime, so the browser never talks to the API.
import type { components } from "./api-types";

type S = components["schemas"];
export type SearchResult = S["SearchResult"];
export type SeriesHit = S["SeriesHit"] & { topics?: string[] }; // topics: newer API only
export type SeriesDetail = S["SeriesDetail"];
// GET /series/{id}/related is newer than the generated OpenAPI types: mirrors RelatedHit/RelatedResult in api_models.py by hand.
export type RelatedHit = SeriesHit & { reason: string };
export type RelatedResult = { series_id: string; hits: RelatedHit[]; citation: S["Citation"] };
// Not in the OpenAPI schema (the route returns a bare JSONResponse), so PLAN.md 4.11 by hand.
export type ObservationsResult = {
  series_id: string;
  status: "ok" | "rate_limited" | "not_found" | "forbidden";
  columns: string[];
  rows: unknown[][];
  truncated: boolean; // more rows follow at next_offset
  partial?: boolean; // the dataset is partial: a row cap cut its ingest or on-demand fetch
  retry_after?: number | null;
  warning?: string | null; // why the rows are empty or partial, verbatim from the API
  citations: S["Citation"][];
};
export type SqlResult = S["SqlResult"];
// GET /sources has no response_model in the API's OpenAPI schema, so this is PLAN.md 4.11 by hand.
export type SourceStatus = {
  id: string;
  name: string;
  kind: string;
  auth: string;
  key_configured: boolean;
  enabled: boolean;
  redistribute: string;
  datasets: number;
  series: number;
  last_ingested_at: string | null;
  stale_datasets: number;
  topics?: string[]; // newer API only
  description?: string;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const base = () => (process.env.STATMESH_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(base() + path, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(502, `Cannot reach the statmesh API at ${base()}`);
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new ApiError(r.status, body.detail ?? r.statusText);
  }
  return r.json();
}

const qs = (o: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) if (x) p.append(k, x);
  return p.size ? `?${p}` : "";
};
const idPath = (id: string) => id.split("/").map(encodeURIComponent).join("/");

export const search = (o: {
  q: string; geo?: string; freq?: string; source?: string | string[]; topic?: string[]; start_year?: string; end_year?: string;
  updated_since?: string; redistribute?: string;
}) =>
  json<SearchResult>(`/search${qs({ ...o, limit: "25" })}`);
export const describe = (id: string) => json<SeriesDetail>(`/series/${idPath(id)}`);
export const relatedSeries = (id: string, o: { geo?: string; limit?: number } = {}) =>
  json<RelatedResult>(`/series/${idPath(id)}/related${qs({ geo: o.geo, limit: o.limit === undefined ? undefined : String(o.limit) })}`);
export const sources = (o: { q?: string; kind?: string; topic?: string[]; redistribute?: string; auth?: string; status?: string } = {}) =>
  json<SourceStatus[]>(`/sources${qs(o)}`);
/** Read-only SQL (one SELECT). Only build the text with sqlLiteral/sqlList from ./sql. */
export const sql = (text: string) =>
  json<SqlResult>("/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: text }) });

/** 404/403/429 still carry an ObservationsResult body, so read it whatever the status. */
export async function observations(id: string, o: { start?: string; end?: string; geo?: string; limit?: number; signal?: AbortSignal } = {}) {
  const { signal, limit, ...q } = o;
  const r = await apiFetch(`/series/${idPath(id)}/observations${qs({ ...q, limit: limit === undefined ? undefined : String(limit) })}`, { signal });
  const body = await r.json().catch(() => ({}));
  if (body && typeof body.status === "string") return body as ObservationsResult;
  throw new ApiError(r.status, body.detail ?? r.statusText);
}

/** What one live fetch of a series returned. `error`: the API did not answer (or the wait timed out). */
export type LiveOutcome = {
  series_id: string;
  status: ObservationsResult["status"] | "error";
  loaded: boolean; // rows came back after the fetch
  warning: string | null;
  retry_after: number | null;
  source: string | null; // source name for "Loaded live from ..."
  retrieved: string | null; // retrieved_at of the rows
};

const LIVE_TTL_MS = 60_000;
const liveMemo = new Map<string, { at: number; out: LiveOutcome }>();

/**
 * Asks the API for one observation so an on-demand dataset fetches its rows now (a 3-part key fetches every geo).
 * Memoised per series for 60 s, so a refresh does not refetch an empty result in a loop. Errors are not memoised.
 */
export async function triggerLive(id: string, timeoutMs = 20_000): Promise<LiveOutcome> {
  const hit = liveMemo.get(id);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.out;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let out: LiveOutcome;
  try {
    const r = await observations(id, { limit: 1, signal: ctl.signal });
    const c = r.citations?.[0];
    out = {
      series_id: id, status: r.status, loaded: r.status === "ok" && (r.rows?.length ?? 0) > 0,
      warning: r.warning ?? null, retry_after: r.retry_after ?? null,
      source: c?.source_name ?? null, retrieved: c?.retrieved_at ?? null,
    };
  } catch {
    out = { series_id: id, status: "error", loaded: false, warning: null, retry_after: null, source: null, retrieved: null };
  } finally {
    clearTimeout(timer);
  }
  if (out.status !== "error") liveMemo.set(id, { at: Date.now(), out });
  return out;
}
