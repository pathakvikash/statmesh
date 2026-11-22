/** Normalises text typed in a search box before it becomes the first chat message. Null when there is nothing to ask. */
export function cleanQuestion(text: string | null | undefined, max = 500): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}
