/** Stable partition: items with stored data first, API order kept inside each group. */
export function rankByData<T>(items: T[], has: (t: T) => boolean): { ranked: T[]; withData: number } {
  const a = items.filter(has);
  return { ranked: [...a, ...items.filter((x) => !has(x))], withData: a.length };
}

/** `source:dataset` ids (two parts) are whole datasets, not single indicators. */
export const isDatasetId = (id: string) => id.split(":").length === 2;
