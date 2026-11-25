/** Broader official-statistics search terms near a query that found nothing. Curated, deterministic; never a promise of results. */
const GROUPS: { words: string[]; terms: string[] }[] = [
  { words: ["drone", "drones", "uav", "robot", "robots", "robotics", "automation", "3d", "printing", "printer", "rc", "toy", "toys"],
    terms: ["research and development", "manufacturing", "trade in goods"] },
  { words: ["internet", "software", "app", "apps", "online", "web", "broadband", "digital", "ict", "cloud", "ai"],
    terms: ["ICT", "internet", "telecommunications"] },
  { words: ["patent", "patents", "invention", "inventions", "innovation", "trademark", "trademarks"],
    terms: ["research and development", "patent"] },
  { words: ["car", "cars", "vehicle", "vehicles", "automotive", "truck", "trucks"],
    terms: ["transport", "manufacturing", "trade in goods"] },
  { words: ["solar", "wind", "battery", "batteries", "renewable", "renewables"],
    terms: ["energy", "electricity"] },
];

/** Up to `max` related search terms for `q` (keyword groups, in curated order); never echoes the query itself. */
export function relatedTopics(q: string, max = 4): string[] {
  const tokens = new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const own = q.trim().toLowerCase();
  const out: string[] = [];
  for (const g of GROUPS) {
    if (!g.words.some((w) => tokens.has(w))) continue;
    for (const t of g.terms) if (t.toLowerCase() !== own && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
}
