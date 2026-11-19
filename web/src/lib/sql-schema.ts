import { apiFetch } from "./client";
import { FALLBACK_SCHEMA } from "./sql-schema-fallback";

export type SqlColumn = { name: string; type: string; description: string; example: string | null };
export type SqlView = { name: string; description: string; joins: string[]; columns: SqlColumn[] };
export type SqlSchema = { views: SqlView[] };

/** Server-side: GET /schema, falling back to the bundled copy while the API does not have that route yet. */
export async function loadSchema(): Promise<{ schema: SqlSchema; live: boolean }> {
  try {
    const r = await apiFetch("/schema");
    if (r.ok) {
      const body = (await r.json()) as SqlSchema;
      if (Array.isArray(body.views) && body.views.length) return { schema: body, live: true };
    }
  } catch {}
  return { schema: FALLBACK_SCHEMA, live: false };
}
