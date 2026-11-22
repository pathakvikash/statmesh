// Builds the sidebar question for "Ask AI about this series/source". Pure; contains no figures, so every number the
// model shows must come from tool results (rule 7). Output is capped at 500 characters (see cleanQuestion).
export type AskTarget =
  | { kind: "series"; id: string; title: string; source?: string }
  | { kind: "source"; id: string; name: string };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function askAbout(t: AskTarget, question?: string): string {
  const q = question?.trim() ? cut(question.trim(), 200) : "";
  // The rule-7 instruction comes first so the 500-character cap can only ever trim the title or question.
  if (t.kind === "series") {
    const ask = q || "give a short overview: what it measures, the latest value and recent trend, one caveat";
    return cut(
      "Use describe_series and get_observations for every number and cite the series id. " +
        `About the series "${cut(t.title, 150)}" (id ${cut(t.id, 80)}${t.source ? `, ${cut(t.source, 60)}` : ""}): ${ask}.`,
      500,
    );
  }
  const ask = q || "give a short overview: what it covers, how fresh it is, which topics have the most data";
  return cut(
    "Use list_sources, search_series (source filter) and run_sql for every number. " +
      `About the data source "${cut(t.name, 150)}" (id ${cut(t.id, 80)}): ${ask}.`,
    500,
  );
}
