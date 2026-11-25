/** "Request this data" link: `base` (STATMESH_ISSUES_URL) reduced to https origin + path, plus a prefilled new-issue query. Null when unset or unsafe. */
export function gapLink(base: string | undefined, q: string): string | null {
  const query = q.replace(/\s+/g, " ").trim().slice(0, 80).trim();
  if (!base || !query) return null;
  let u: URL;
  try { u = new URL(base.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const root = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  return `${root}?template=data-gap.yml&title=${encodeURIComponent(`Data gap: ${query}`)}&labels=data-gap`;
}
