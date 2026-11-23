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

type Sx = Exclude<Sex, "all">;
type Group = { re: RegExp; w: number; why: string };

/** Weighted keyword groups. Per sex: topics that matter to that sex; BOTH: headline outcomes shown on either tab. */
const GROUPS: Record<Sx, Group[]> = {
  female: [{ re: /fertility|birth rate|maternal|antenatal|contracept|family planning|pregnan|breast|cervical|skilled birth|caesarean/i, w: 5, why: "Female health" }],
  male: [{ re: /adult mortality|prostate|smok|tobacco|alcohol|suicide|road traffic|injur/i, w: 4, why: "Male health" }],
};
const HEADLINE: Group = { re: /life expectancy/i, w: 5, why: "Headline outcome" };
const BOTH: Group[] = [HEADLINE, { re: /under-five|infant mortality|neonatal/i, w: 3, why: "Child survival" }, { re: /^population\b|total population/i, w: 1, why: "Context" }];
/** Topics that only make sense for one sex: a hit disqualifies the title from the other sex's picks. */
const ONLY: Record<Sx, RegExp> = {
  female: /maternal|antenatal|pregnan|breast|cervical|ovarian|fertility|contracept|family planning|skilled birth|caesarean/i,
  male: /prostate|testicular/i,
};

export type Candidate = { id: string; title: string; sexes?: Sex[] }; // sexes: sex values stored on the series for this country

/** `why` is a short UI label for the strongest reason; optional so existing callers are unaffected. */
export type Pick = { id: string; title: string; sex: "title" | Sx; score: number; why?: string };

const family = (t: string) => t.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 2).join(" ");
const MAX_PER_FAMILY = 2;

/**
 * Most relevant candidates for one sex, deterministic and explainable. Excluded: titles about, or only meaningful
 * for, the other sex. Score = stored split containing the sex (+4) + title naming the sex (+3) + best matching
 * keyword group (female/male topics, headline outcome +5, child survival +3, population +1). At most 2 per
 * family (first two title words); a headline indicator (life expectancy) is kept in the list when any exists.
 * Ties break by id. Only Male/Female have picks.
 */
export function pickRelated(sex: Sex, cands: Candidate[], limit = 6): Pick[] {
  if (sex === "all") return [];
  const other: Sx = sex === "male" ? "female" : "male";
  const scored: Pick[] = [];
  for (const c of cands) {
    if (sexOfTitle(c.title) === other || ONLY[other].test(c.title)) continue;
    const split = !!c.sexes?.includes(sex), named = sexOfTitle(c.title) === sex;
    const g = [...GROUPS[sex], ...BOTH].filter((x) => x.re.test(c.title)).sort((a, b) => b.w - a.w)[0];
    const score = (split ? 4 : 0) + (named ? 3 : 0) + (g?.w ?? 0);
    if (score <= 0) continue;
    const why = g?.why ?? (named ? `${SEX_LABEL[sex]}-specific` : `Has ${SEX_LABEL[sex]} split`);
    scored.push({ id: c.id, title: c.title, sex: split ? sex : "title", score, why });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Map<string, number>(), out: Pick[] = [];
  for (const p of scored) {
    const f = family(p.title);
    if ((seen.get(f) ?? 0) >= MAX_PER_FAMILY) continue;
    seen.set(f, (seen.get(f) ?? 0) + 1);
    out.push(p);
  }
  const top = out.slice(0, limit);
  const head = out.find((p) => HEADLINE.re.test(p.title));
  if (head && limit > 0 && !top.includes(head)) top[top.length - 1] = head;
  return top;
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
