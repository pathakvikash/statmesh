/** Shared-cache headers only when the web cache is on; a local or self-hosted API must not be held stale by a proxy. */
export const paletteHeaders = (webCache: boolean): Record<string, string> =>
  webCache ? { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } : {};

