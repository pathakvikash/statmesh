/** Which geo a click on the line chart's legend means: match the legend text to a drawn geo's display name (or code). */
export function geoByLabel(label: string, geos: string[], names: Map<string, string>): string | null {
  const t = label.trim();
  return geos.find((g) => (names.get(g) ?? g) === t) ?? null;
}
