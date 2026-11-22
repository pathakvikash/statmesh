import { describe } from "@/lib/client";
import { geoLatest, geoName, geoRows, type GeoInfo } from "@/lib/data";
import { defaultCompareGeos, parseGeoParam } from "@/lib/compare";
import { unitLabel } from "@/lib/format";
import { defaultGeos } from "@/lib/multigeo";
import type { CompareSeries } from "@/components/compare/CompareChart";

/**
 * Compare mode: the main series and each compared series for the chosen countries. Compared series use their
 * dominant dimension combination; the main series uses the page's dimension selection. Missing series are noted, not fatal.
 */
export async function loadCompare(id: string, title: string, ml: GeoInfo, sel: Record<string, string> | undefined,
  cmp: { ids: string[]; tooMany: boolean; rejected: string[] }, geoParam: string | undefined, names: Map<string, string>) {
  const avail = ml.rows.filter((r) => !r.geo.startsWith("unmapped:")).map((r) => r.geo);
  const notes: string[] = [];
  if (cmp.tooMany) notes.push("Only 3 series can be compared; the first 3 are shown.");
  if (cmp.rejected.length) notes.push(`Ignored: ${cmp.rejected.join(", ")} (not a series id).`);
  // Latest values of every compared series first: the default countries need what each series has.
  const extra: { id: string; title: string; info: GeoInfo; latest: Map<string, number> }[] = [];
  for (const cid of cmp.ids) {
    try {
      const [info, det] = await Promise.all([geoLatest(cid), describe(cid).catch(() => null)]);
      if (!info || !det) { notes.push(`No observations for ${cid}.`); continue; }
      extra.push({ id: cid, title: det.title, info, latest: latestMap(info) });
    } catch {
      notes.push(`Could not load ${cid}.`);
    }
  }
  const drawn = [{ id, title, latest: latestMap(ml) }, ...extra];
  // An explicit geo= wins (filtered to real geos as before); otherwise the geos every drawn series has.
  const defaults = extra.length ? defaultCompareGeos(new Map(drawn.map((d) => [d.id, d.latest])), id) : defaultGeos(ml.rows, 3);
  const geos = parseGeoParam(geoParam, avail, defaults);
  const series: CompareSeries[] = [{ id, title, unit: unitLabel(ml.unit, ml.unitMult), freq: ml.freq, points: await geoRows(id, ml, geos, sel) }];
  for (const e of extra) {
    try {
      series.push({ id: e.id, title: e.title, unit: unitLabel(e.info.unit, e.info.unitMult), freq: e.info.freq, points: await geoRows(e.id, e.info, geos) });
    } catch {
      notes.push(`Could not load ${e.id}.`);
    }
  }
  // Per country: the titles of the drawn series with no value for it (the picker shows them and sorts full countries first).
  const geoOptions = avail.map((g) => ({
    geo: g, name: geoName(names, g) ?? g, missing: drawn.filter((d) => !d.latest.has(g)).map((d) => d.title),
  }));
  return { series, geos, notes, geoOptions };
}

/** Latest value per geo of one series, without aggregates' unmapped codes. */
const latestMap = (info: GeoInfo) => new Map(info.rows.filter((r) => !r.geo.startsWith("unmapped:")).map((r) => [r.geo, r.v] as const));
