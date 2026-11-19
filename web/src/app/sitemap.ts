import type { MetadataRoute } from "next";
import { sql } from "@/lib/client";
import { seriesHref } from "@/lib/format";
import { siteUrl } from "@/lib/mode";

export const dynamic = "force-dynamic";

const PAGES = ["", "/series", "/sources", "/sql", "/chat"];
const PER_SOURCE = 100;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const out: MetadataRoute.Sitemap = PAGES.map((p) => ({ url: base + p }));
  try {
    // The API only serves what this instance may serve, so no licence check here.
    const r = await sql(
      `SELECT series_key FROM (SELECT series_key, row_number() OVER (PARTITION BY source_id ORDER BY series_key) AS n FROM series) WHERE n <= ${PER_SOURCE} ORDER BY series_key`,
    );
    for (const row of r.rows) out.push({ url: base + seriesHref(String(row[0])) });
  } catch {
    // API down: the static pages still make a valid sitemap.
  }
  return out;
}
