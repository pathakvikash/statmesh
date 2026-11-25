/** Exact match on a place's name or code (case-insensitive); partial text never matches. */
export const findGeo = (geos: { code: string; name: string }[], text: string) => {
  const t = text.trim().toLowerCase();
  return t ? geos.find((g) => g.name.toLowerCase() === t || g.code.toLowerCase() === t) : undefined;
};
