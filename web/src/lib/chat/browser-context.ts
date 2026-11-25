// Server side of the on-device assistant: top series for a question, with the latest value and Rule 7 citation fields.
import { describe, search } from "@/lib/client";
import { hitStats } from "@/lib/data";
import { formatValue } from "@/lib/format";
import { clientIp, hashIp, sharedStore, type CounterStore } from "./free";
import type { Fact } from "./browser-llm";

export const MAX_FACTS = 5;

/** "million persons": the unit with its multiplier, so 1.2 with unit_mult 6 is never read as 1.2 persons. */
const unitText = (unit: string | null | undefined, mult: number | null | undefined) => formatValue("", unit, mult) || null;

export async function buildFacts(q: string): Promise<Fact[]> {
  const hits = (await search({ q, redistribute: "yes" })).hits.slice(0, MAX_FACTS);
  const ids = hits.map((h) => h.series_id);
  const [stats, details] = await Promise.all([
    hitStats(ids, 1),
    Promise.all(ids.map((id) => describe(id).catch(() => null))),
  ]);
  return hits.map((h, i) => {
    const st = stats[h.series_id];
    // A multi-geo key's points are a median/World aggregate, not a country value: give no latest value.
    const last = st?.multi ? undefined : st?.points.at(-1);
    const c = details[i]?.citation;
    return {
      id: h.series_id, title: h.title, source: c?.source_name ?? h.source_id,
      url: c?.source_url || details[i]?.source_url || `/series/${h.series_id}`,
      value: last?.v ?? null, unit: unitText(st?.unit ?? h.unit, st?.unitMult), period: last?.t ?? null, geo: h.geo,
    };
  });
}

export const CTX_LIMIT = 30;
/**
 * 30 questions per minute per client, via the shared store (Upstash when configured, else per instance). Callers
 * without a trusted IP (see clientIp / STATMESH_TRUST_PROXY) share one global bucket, so they are limited, not free.
 */
export async function allow(req: Request, store: CounterStore = sharedStore(), env: Env = process.env): Promise<boolean> {
  const ip = clientIp(req, env);
  const who = ip === "unknown" ? "unknown" : hashIp(ip, env);
  return (await store(`sm:ctx:${who}:${Math.floor(Date.now() / 60000)}`, 90)) <= (ip === "unknown" ? CTX_LIMIT * 4 : CTX_LIMIT);
}
type Env = Record<string, string | undefined>;
