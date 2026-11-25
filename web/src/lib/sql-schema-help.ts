import type { SqlView } from "./sql-schema";

/** Plain-English one-liners per table, for people who know no SQL. Names match docs/data-model.md. */
const TABLE_HELP: Record<string, string> = {
  observations: "Every number we have, one row per place and date. Start here.",
  series: "The list of measures (like 'unemployment rate'), one row each. Observations point to these.",
  datasets: "Groups of related measures published together by one source.",
  sources: "Who publishes the data (IMF, World Bank, ...), with their licence and web address.",
  geos: "Places: countries (codes like IND for India) and regions (like region:EU27), plus Indian states (like IN-MH) where a source provides them.",
  geo_groups: "Which group a place belongs to (for example, which countries are in the EU).",
  entities: "Companies and other organisations that data can be about.",
  entity_xref: "Developer table: maps one organisation's IDs between different sources.",
  observations_vintages: "Developer table: every past version of each number, before revisions.",
};

/** Developer-only tables, collapsed under "More tables". */
const ADVANCED = new Set(["entity_xref", "observations_vintages", "geo_groups"]);

/** What each column means, in everyday words. Shared across tables because names mean the same thing everywhere. */
const COLUMN_HELP: Record<string, string> = {
  geo: "A place code, such as IND for India (regions look like region:EU27; Indian states, where available, like IN-MH).",
  period_start: "The date the number is for (or the day that period begins).",
  period_end: "The last day of the period the number covers.",
  value: "The number itself.",
  unit: "What the number is measured in, such as percent or US dollars.",
  unit_mult: "Multiply the value by this to get the full number (for example 1000000 means millions).",
  freq: "How often it is published: A is yearly, Q quarterly, M monthly.",
  obs_status: "A flag from the source, such as estimate or provisional.",
  source_id: "Which provider published it, such as imf or worldbank.",
  dataset_id: "The provider's own code for the group this measure belongs to.",
  indicator_id: "The provider's own code for the measure.",
  series_id: "Identifier of the measure this number belongs to.",
  series_key: "A unique label for the measure: source, dataset and indicator joined by colons.",
  dims: "Extra labels such as sex or age group that split one measure into parts.",
  dims_json: "The same extra labels, stored as text.",
  retrieved_at: "When we last fetched this from the source.",
  vintage: "The date this version of the number was published.",
  title: "A readable name.",
  name: "A readable name.",
  description: "A short explanation in words.",
  attribution: "The credit line you should show when using this data.",
  licence_name: "The licence that says how the data may be reused.",
  licence_url: "A web link to the full licence text.",
  redistribute: "Whether we are allowed to pass the data on to others.",
  source_url: "A web link to where the source publishes it.",
  source_updated_at: "When the source last changed it.",
  last_ingested_at: "When we last loaded this into our database.",
  kind: "The type of thing this is.",
  country: "The country this place belongs to.",
  group_id: "Identifier of a group of places.",
  entity_id: "Identifier of an organisation.",
  from_id: "The identifier in the first system.",
  to_id: "The matching identifier in the second system.",
  industry_code: "The code for the business sector, in the scheme named next to it.",
  industry_scheme: "Which sector coding system the code belongs to.",
  is_core: "Whether this is one of our main, most-used measures.",
  key_required: "Whether the source needs an access key.",
  endpoint: "The web address we fetch the data from.",
  auth: "How we sign in to the source, if at all.",
  status: "Whether this is active, or otherwise.",
  start_date: "The first date it applies.",
  end_date: "The last date it applies.",
  discovered_at: "When we first found this.",
  inferred: "Whether we worked this out ourselves rather than being told.",
  confidence: "How sure we are about this match.",
  id: "A unique identifier.",
  address: "A street or web address.",
  attrs: "Extra details, stored as text.",
  iso2: "The two-letter country code, such as IN.",
  m49: "The United Nations numeric code for the place.",
  geos: "The places this measure has numbers for.",
};

export const FALLBACK_TABLE = "A table of data. Click it to see its columns.";
export const FALLBACK_COLUMN = "A column in this table. Click it to add its name to your question.";

export const tableHelp = (name: string, fallback?: string) => TABLE_HELP[name] ?? (fallback || FALLBACK_TABLE);
export const columnHelp = (name: string, fallback?: string) => COLUMN_HELP[name] ?? (fallback || FALLBACK_COLUMN);
export const isAdvancedTable = (name: string) => ADVANCED.has(name);

/** Filter tables by search text on table name/help and column names/help; keeps only matching columns. */
export function filterViews(views: SqlView[], q: string): { v: SqlView; cols: SqlView["columns"] }[] {
  const f = q.trim().toLowerCase();
  if (!f) return views.map((v) => ({ v, cols: v.columns }));
  return views
    .map((v) => {
      const tableHit = (v.name + " " + tableHelp(v.name, v.description)).toLowerCase().includes(f);
      const cols = v.columns.filter((c) => (c.name + " " + columnHelp(c.name, c.description)).toLowerCase().includes(f));
      return { v, cols: tableHit && !cols.length ? v.columns : cols };
    })
    .filter(({ cols }) => cols.length > 0);
}
