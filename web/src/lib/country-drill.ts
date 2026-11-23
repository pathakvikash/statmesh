// Pure logic for the in-place country drill (no server imports, so the client component and tests can use it).

export type Sex = "all" | "male" | "female";
export const SEXES: Sex[] = ["all", "male", "female"];
export const SEX_LABEL: Record<Sex, string> = { all: "Overall", male: "Male", female: "Female" };

/** `?c=IND` -> "IND". Never `?geo=` (that is Compare mode). Anything that is not a plain geo code is ignored. */
export function parseCountryParam(v: string | string[] | null | undefined): string | null {
  const s = (Array.isArray(v) ? v[0] : v)?.trim().toUpperCase();
  return s && /^[A-Z0-9][A-Z0-9_-]{1,11}$/.test(s) ? s : null;
}

/** `?sex=` of the drill: unknown values fall back to Overall. */
export const parseSexParam = (v: string | null | undefined): Sex => (SEXES as string[]).includes(v ?? "") ? (v as Sex) : "all";

/** The page URL's query with the drill's country set or cleared; every other param is kept (dim.*, freq, compare...). */
export function withCountry(search: string, c: string | null, sex: Sex = "all"): string {
  const p = new URLSearchParams(search);
  p.delete("c"); p.delete("sex");
  if (c) { p.set("c", c); if (sex !== "all") p.set("sex", sex); }
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A sex dimension value as stored (WHO: SEX_MLE / SEX_FMLE / SEX_BTSX; SDMX: M / F / T / _T / MF). */
export function sexOfCode(code: string): Sex | null {
  const c = code.trim().toUpperCase().replace(/^SEX_/, "");
  if (["M", "MLE", "MALE", "MALES"].includes(c)) return "male";
  if (["F", "FMLE", "FEMALE", "FEMALES"].includes(c)) return "female";
  if (["T", "_T", "MF", "BTSX", "BOTH", "TOTAL", "ALL"].includes(c)) return "all";
  return null;
}

const SEX_DIM = /^(sex|gender)$/i;

/** The series' own sex dimension (series.dims / seriesShape dims): its name and the stored code per sex. Null when it has none or no male/female value. */
export function sexSplit(dims: Record<string, string[]> | null | undefined): { dim: string; codes: Partial<Record<Sex, string>> } | null {
  for (const [dim, values] of Object.entries(dims ?? {})) {
    if (!SEX_DIM.test(dim)) continue;
    const codes: Partial<Record<Sex, string>> = {};
    for (const v of values) { const s = sexOfCode(v); if (s && !codes[s]) codes[s] = v; }
    if (codes.male && codes.female) return { dim, codes };
  }
  return null;
}

const FEMALE_WORDS = /\b(female|females|women|woman|girl|girls|maternal|pregnant|pregnancy)\b/i;
const MALE_WORDS = /\b(male|males|men|man|boy|boys)\b/i;

/** Sex a series title is about ("Number of female leprosy new cases"), or null when it names neither or both. */
export function sexOfTitle(title: string): Exclude<Sex, "all"> | null {
  const f = FEMALE_WORDS.test(title), m = MALE_WORDS.test(title);
  return f === m ? null : f ? "female" : "male";
}

/** Topic words that make an indicator relevant to one sex even when its title does not say so. */
const TOPIC: Record<Exclude<Sex, "all">, RegExp> = {
  female: /fertility|birth|maternal|antenatal|contracept|family planning|pregnan|breast|cervical/i,
  male: /adult mortality|life expectancy|suicide|road traffic|alcohol|smok|tobacco|injur/i,
};

export type Candidate = { id: string; title: string; sexes?: Sex[] }; // sexes: sex values stored on the series for this country

export type Pick = { id: string; title: string; sex: "title" | Exclude<Sex, "all">; score: number };

/**
 * Most relevant candidates for one sex. Excluded: titles about the other sex. Scored: a stored split containing
 * that sex (+4), the title naming that sex (+3), topic words (+2). Ties keep input order. Only Male/Female have picks.
 */
export function pickRelated(sex: Sex, cands: Candidate[], limit = 6): Pick[] {
  if (sex === "all") return [];
  const other = sex === "male" ? "female" : "male";
  const out: Pick[] = [];
  for (const c of cands) {
    const ts = sexOfTitle(c.title);
    if (ts === other) continue;
    const split = !!c.sexes?.includes(sex);
    const score = (split ? 4 : 0) + (ts === sex ? 3 : 0) + (TOPIC[sex].test(c.title) ? 2 : 0);
    if (score > 0) out.push({ id: c.id, title: c.title, sex: split ? sex : "title", score });
  }
  return out.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score || a.i - b.i).slice(0, limit).map((x) => x.p);
}

/** 1-based rank (largest = 1) of `geo` among rows, with the peer count; null when geo is not in rows. */
export function rankOf(rows: { geo: string; v: number }[], geo: string): { rank: number; of: number } | null {
  const me = rows.find((r) => r.geo === geo);
  return me ? { rank: 1 + rows.filter((r) => r.v > me.v).length, of: rows.length } : null;
}

/** Change between the last two points (computed). Null with fewer than 2 points. */
export function trendOf(points: { t: string; v: number }[]): { from: { t: string; v: number }; to: { t: string; v: number }; delta: number; pct: number | null } | null {
  if (points.length < 2) return null;
  const from = points.at(-2)!, to = points.at(-1)!;
  return { from, to, delta: to.v - from.v, pct: from.v !== 0 ? ((to.v - from.v) / Math.abs(from.v)) * 100 : null };
}

/** The dimension selection the drill applies to BOTH the country query and the rank query, so headline and rank cannot disagree. */
export function drillSelection(dims: Record<string, string>, split: { dim: string; codes: Partial<Record<Sex, string>> } | null, sex: Sex): { sel: Record<string, string>; noData: boolean } {
  const sel = { ...dims };
  const code = split?.codes[sex];
  if (split && code && !(sex === "all" && split.dim in sel)) sel[split.dim] = code;
  return { sel, noData: sex !== "all" && !code };
}

/** 3-part series key of a related hit (relatedSeries with a geo returns 4-part ids). */
export const relatedBase = (id: string): string => id.split(":").slice(0, 3).join(":");

/** Citation line of one series: "Source / dataset, retrieved YYYY-MM-DD". */
export const citeLine = (c: { source_name: string; dataset_id: string; retrieved_at?: string | null }): string =>
  `${c.source_name} / ${c.dataset_id}${c.retrieved_at ? `, retrieved ${c.retrieved_at.slice(0, 10)}` : ""}`;
