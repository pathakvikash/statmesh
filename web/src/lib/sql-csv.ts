/** CSV cell. String cells starting with = + - @ tab or CR get a leading ' so spreadsheets do not run them as formulas. */
export const cell = (v: unknown): string => {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const toCsv = (columns: string[], rows: unknown[][]): string =>
  [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
