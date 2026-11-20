import { Table } from "@/components/Table";
import { periodLabel, unitLabel } from "@/lib/format";

/** One period, one geo: the value large, then the same period for any other geos. */
export function ValueCard({ value, unit, mult, period, freq, geo, others }: {
  value: number; unit?: string | null; mult?: number | null; period: string; freq?: string | null; geo: string | null;
  others: { geo: string; v: number }[];
}) {
  const u = unitLabel(unit, mult);
  return (
    <div className="space-y-4">
      <div>
        <div className="text-4xl font-semibold tracking-tight tabular-nums">
          {value.toLocaleString("en-US", { maximumFractionDigits: 3 })}
          {u && <span className="ml-1.5 text-base font-normal text-muted-foreground">{u}</span>}
        </div>
        <div className="text-sm text-muted-foreground">
          {geo ? <span className="font-medium text-foreground">{geo} · </span> : null}{periodLabel(period, freq)}
        </div>
      </div>
      {others.length > 0 && (
        <Table columns={["geo", "value"]} rows={others.map((o) => [o.geo, o.v.toLocaleString("en-US", { maximumFractionDigits: 3 })])}
          caption={`Same period (${periodLabel(period, freq)}) for other geographies${u ? `, in ${u}` : ""}.`} />
      )}
    </div>
  );
}
