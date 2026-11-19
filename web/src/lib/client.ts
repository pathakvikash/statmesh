// Server-side client: only call from server components and route handlers.
// STATMESH_API_URL is read at runtime, so the browser never talks to the API.
import type { components } from "./api-types";

type S = components["schemas"];
export type SearchResult = S["SearchResult"];
export type SeriesHit = S["SeriesHit"] & { topics?: string[] }; // topics: newer API only
export type SeriesDetail = S["SeriesDetail"];
// Not in the OpenAPI schema (the route returns a bare JSONResponse), so PLAN.md 4.11 by hand.
export type ObservationsResult = {
  series_id: string;
  status: "ok" | "rate_limited" | "not_found" | "forbidden";
  columns: string[];
  rows: unknown[][];
  truncated: boolean; // more rows follow at next_offset
  partial?: boolean; // the dataset is partial: a row cap cut its ingest or on-demand fetch
  retry_after?: number | null;
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
export const sources = (o: { q?: string; kind?: string; topic?: string[]; redistribute?: string; auth?: string; status?: string } = {}) =>
  json<SourceStatus[]>(`/sources${qs(o)}`);
/** Read-only SQL (one SELECT). Only build the text with sqlLiteral/sqlList from ./sql. */
export const sql = (text: string) =>
  json<SqlResult>("/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: text }) });

/** 404/403/429 still carry an ObservationsResult body, so read it whatever the status. */
export async function observations(id: string, o: { start?: string; end?: string; geo?: string; signal?: AbortSignal } = {}) {
  const { signal, ...q } = o;
  const r = await apiFetch(`/series/${idPath(id)}/observations${qs(q)}`, { signal });
  const body = await r.json().catch(() => ({}));
  if (body && typeof body.status === "string") return body as ObservationsResult;
  throw new ApiError(r.status, body.detail ?? r.statusText);
}
