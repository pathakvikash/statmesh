import { formatValue } from "@/lib/format";

type Row = unknown[];

/** Generic result table. If the result has `value` and `unit` columns, the value is shown with its unit. */
export function Table({ columns, rows, caption }: { columns: string[]; rows: Row[]; caption: string }) {
  const iv = columns.indexOf("value");
  const iu = columns.indexOf("unit");
  const im = columns.indexOf("unit_mult");
  const cell = (r: Row, i: number) =>
    i === iv && iu >= 0 ? formatValue(r[i], r[iu] as string, im >= 0 ? (r[im] as number) : null) : String(r[i] ?? "");
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="mb-1 text-left text-muted-foreground">{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c} scope="col" className="border-b border-border px-2 py-1">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-muted/50">
              {columns.map((c, j) => <td key={c} className="px-2 py-1 tabular-nums">{cell(r, j)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
