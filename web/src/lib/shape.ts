// Pure series-shape model: what a series' observations look like and which view renders them.
// No server imports, so client code and tests can use it. The SQL side lives in data.ts (seriesShape).

export type ShapeStatus = "ingested" | "remote" | "stale" | "unknown";
export type View = "empty" | "value" | "ranked" | "line" | "multi-line";

export type Shape = {
  rows: number;
  geos: number;
  periods: { n: number; first: string | null; last: string | null };
  freqs: string[]; // most populated first
  dims: Record<string, string[]>; // dimension name -> distinct values, most rows first
  units: string[];
  status: ShapeStatus;
};

/** What the page can see of one observation: enough to derive a Shape from loaded rows. */
export type RowFact = { geo: string | null; t: string | null; freq?: string | null; dims?: Record<string, unknown> | null; unit?: string | null };

const STATUSES: ShapeStatus[] = ["ingested", "remote", "stale"];

/**
 * empty: no rows. value: one period, one geo. ranked: many geos over 1 to 3 periods.
 * line: one geo over 2+ periods. multi-line: many geos over 4+ periods.
 */
export function chooseView(s: { rows: number; geos: number; periods: { n: number } }): View {
  if (s.rows === 0 || s.periods.n === 0) return "empty";
  if (s.geos <= 1) return s.periods.n === 1 ? "value" : "line";
  return s.periods.n <= 3 ? "ranked" : "multi-line";
}

/** Most frequent value (ties go to the first seen). undefined for no values. */
export function dominant<T>(values: T[]): T | undefined {
  const n = new Map<T, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  let best: T | undefined, bestN = 0;
  for (const [v, c] of n) if (c > bestN) { best = v; bestN = c; }
  return best;
}

/** Shape of already-loaded observation rows (the caller filters to valid rows first). */
export function shapeFromRows(rows: RowFact[]): Shape {
  const periods = new Set<string>(), geos = new Set<string>(), freqs: string[] = [], units: string[] = [];
  const dims = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.t) periods.add(r.t);
    if (r.geo) geos.add(r.geo);
    if (r.freq) freqs.push(r.freq);
    if (r.unit) units.push(r.unit);
    for (const [k, v] of Object.entries(r.dims ?? {})) {
      const m = dims.get(k) ?? new Map<string, number>();
      m.set(String(v), (m.get(String(v)) ?? 0) + 1);
      dims.set(k, m);
    }
  }
  const sorted = [...periods].sort();
  return {
    rows: rows.length,
    geos: geos.size,
    periods: { n: periods.size, first: sorted[0] ?? null, last: sorted.at(-1) ?? null },
    freqs: rankByCount(freqs),
    dims: Object.fromEntries([...dims].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v)])),
    units: rankByCount(units),
    status: "unknown",
  };
}

const rankByCount = (xs: string[]) => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([x]) => x);
};

/** Shape from the one aggregate row seriesShape() reads (see data.ts). Unknown status values become "unknown". */
export function shapeFromAggregate(r: Record<string, unknown>, status: unknown): Shape {
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const dimK = arr(r.dim_k).map(String), dimVs = arr(r.dim_vs);
  return {
    rows: Number(r.n_rows ?? 0),
    geos: Number(r.geos ?? 0),
    periods: { n: Number(r.np ?? 0), first: r.first_t ? String(r.first_t) : null, last: r.last_t ? String(r.last_t) : null },
    freqs: arr(r.freqs).map(String),
    dims: Object.fromEntries(dimK.map((k, i) => [k, arr(dimVs[i]).map(String)])),
    units: arr(r.units).map(String),
    status: STATUSES.includes(status as ShapeStatus) ? (status as ShapeStatus) : "unknown",
  };
}

const TOTAL_CODES = new Set(["_T", "T", "TOTAL", "ALL", "_Z"]);
/** The "all categories" value of a dimension when it has one (matched case-insensitively). */
export const totalValue = (values: string[]): string | undefined => values.find((v) => TOTAL_CODES.has(v.toUpperCase()));

/** "age_group" -> "Age group". */
export const dimLabel = (name: string): string => {
  const s = name.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : name;
};

/** Readable option label; only the all-categories codes get words, other codes stay as they are. */
export const valueLabel = (v: string): string => (v.toUpperCase() === "ALL" ? "All" : TOTAL_CODES.has(v.toUpperCase()) ? "Total" : v);

/** Dimensions with more than one value are the ones worth a select. */
export const choiceDims = (dims: Record<string, string[]>): string[] => Object.keys(dims).filter((k) => dims[k].length > 1);

/**
 * The selection per multi-valued dimension. URL params `dim.<name>` win when they name a real value;
 * otherwise the all-categories value, then the dominant combination's value, then the first value.
 */
export function chooseDims(
  params: Record<string, string | undefined>, dims: Record<string, string[]>, combo?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of choiceDims(dims)) {
    const vals = dims[k];
    const asked = params[`dim.${k}`];
    out[k] = asked && vals.includes(asked) ? asked : (totalValue(vals) ?? (combo?.[k] && vals.includes(combo[k]) ? combo[k] : vals[0]));
  }
  return out;
}

/** The dims values of the most populated combination of rows (used when no selection matches any row). */
export function dominantCombo(rows: { dims?: Record<string, unknown> | null }[], dims: string[]): Record<string, string> {
  const pick = dominant(rows.map((r) => JSON.stringify(Object.fromEntries(dims.map((k) => [k, String(r.dims?.[k] ?? "")])))));
  return pick ? (JSON.parse(pick) as Record<string, string>) : {};
}

/** True when a row's dims carry every selected value (a missing dim counts as ""). */
export const rowMatches = (dims: Record<string, unknown> | null | undefined, sel: Record<string, string>): boolean =>
  Object.entries(sel).every(([k, v]) => String(dims?.[k] ?? "") === v);

/** The freq asked for when the series has it, else the most populated freq. */
export const chooseFreq = (asked: string | undefined, freqs: string[]): string | undefined =>
  asked && freqs.includes(asked) ? asked : freqs[0];

export type EmptyReason = { title: string; detail?: string; command?: string };

/**
 * Why a series has no chartable rows. `obs` is the observations result (or an error). Remote datasets that
 * have no rows here are "not loaded", with the ingest command; any warning the API gave is shown as detail.
 */
/** The API's warning when a dataset is remote and on-demand fetching is off on this instance (python: service._NOT_MIRRORED). */
export const NOT_MIRRORED = "Not mirrored on this instance; this dataset is fetched on demand only on self-hosted installs.";

export function emptyReason(a: {
  obs?: { status?: string; retry_after?: number | null; warning?: string | null };
  error?: boolean; dataset: ShapeStatus; source: string; datasetId: string; hosted?: boolean;
}): EmptyReason {
  const warning = a.obs?.warning ?? undefined;
  if (a.error) return { title: "Observations could not be loaded", detail: "The statmesh API did not answer. Try again in a moment." };
  switch (a.obs?.status) {
    case "rate_limited":
      return { title: "The source is rate limited", detail: a.obs.retry_after ? `Retry in about ${Math.ceil(a.obs.retry_after)} s.` : "Retry later." };
    case "forbidden":
      return { title: "Not available on this instance", detail: warning ?? "The licence of this dataset does not allow serving it here." };
    case "not_found":
      return { title: "No data found for this series", detail: warning };
  }
  if (a.hosted && a.dataset === "remote") {
    return { title: "Not mirrored on this instance", detail: warning ?? NOT_MIRRORED };
  }
  // The API answered "ok" with no rows and gave a reason (the source returned nothing, or it is not mirrored here).
  if (a.obs?.status === "ok" && warning) {
    return { title: warning === NOT_MIRRORED ? "Not mirrored on this instance" : "No data for this series", detail: warning };
  }
  if (a.dataset === "remote") {
    return {
      title: "Not loaded yet",
      detail: warning ?? "This dataset is not on this instance yet. Load it with the command below.",
      command: `statmesh ingest ${a.source} --dataset ${a.datasetId}`,
    };
  }
  return { title: "The dataset is loaded but has no values for this series", detail: warning };
}
