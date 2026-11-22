"use client";
import { useMemo, useState } from "react";
import { Pager } from "@/components/ai/Pager";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { pageSlice } from "@/lib/chat/details";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Citations } from "@/components/Citations";
import { explainError, type FriendlyError } from "@/lib/sql-errors";
import { detectChart } from "@/lib/sql-chart";
import { toCsv } from "@/lib/sql-csv";
import type { SqlResult } from "@/lib/client";
import type { SqlSchema } from "@/lib/sql-schema";

export type RunOutcome = { res?: SqlResult; err?: string; ms: number; sql?: string };
const PAGE = 50;
const COLORS = [1, 2, 3, 4, 5].map((i) => `var(--color-chart-${i})`);

const fmt = (v: unknown, col: string): string => {
  if (v == null) return "";
  if (typeof v === "number") return /(^|_)(year|yr)$/i.test(col) ? String(v) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ErrorBox({ e, sql }: { e: FriendlyError; sql: string }) {
  const { ask } = useAssistant();
  const fix = () => ask(`My SQL failed in the statmesh workbench. Error: ${e.raw.slice(0, 200)}. SQL: ${sql.replace(/\s+/g, " ").slice(0, 200)}. Explain the cause and give a corrected SELECT.`);
  return (
    <div role="alert" className="rounded-xl border border-chart-4/40 bg-chart-4/10 p-3 text-sm">
      <p className="font-semibold">{e.title}</p>
      <p>{e.fix}</p>
      <button type="button" onClick={fix} className="mt-2 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium hover:bg-muted">Ask AI to fix</button>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Technical message</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono">{e.raw}</pre>
      </details>
    </div>
  );
}

export function Results({ out, busy, schema }: { out?: RunOutcome; busy: boolean; schema: SqlSchema }) {
  const [pg, setPg] = useState<{ res?: SqlResult; page: number }>({ page: 0 });
  const res = out?.res;
  const spec = useMemo(() => (res ? detectChart(res.columns, res.rows) : null), [res]);
  if (!out) return <p className="p-3 text-sm text-muted-foreground">{busy ? "Running…" : "Run a query (Cmd/Ctrl+Enter) to see rows here."}</p>;
  if (out.err) return <ErrorBox e={explainError(out.err, schema)} sql={out.sql ?? ""} />;
  if (!res) return null;
  const page = pg.res === res ? pg.page : 0; // a new result starts on page 1
  const sl = pageSlice(res.rows.length, page, PAGE);

  return (
    <div aria-live="polite" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{res.rows.length.toLocaleString("en-US")} rows</span>
        <span className="text-muted-foreground">{out.ms < 1000 ? `${Math.round(out.ms)} ms` : `${(out.ms / 1000).toFixed(1)} s`}</span>
        {res.truncated && <span title="The result hit the row cap. Add WHERE or LIMIT to see the rest." className="rounded-full bg-chart-3/20 px-2 py-0.5 text-xs font-medium">truncated</span>}
        <span className="ml-auto flex gap-1">
          <button onClick={() => download("statmesh-query.csv", toCsv(res.columns, res.rows))} className="rounded-lg border border-border bg-card px-2 py-0.5 hover:bg-muted">Export CSV</button>
        </span>
      </div>
      {res.warning && <p className="rounded-xl border border-chart-3/50 bg-chart-3/10 p-2 text-sm"><span className="font-semibold">Heads up: </span>{res.warning}</p>}
      {spec ? (
        <div className="rounded-xl border border-border bg-card p-2">
          {spec.note && <p className="px-1 text-xs text-muted-foreground">{spec.note}</p>}
          <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            {spec.kind === "line" ? (
              <LineChart data={spec.data}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey={spec.x} /><YAxis width={60} /><Tooltip /><Legend />
                {spec.ys.map((y, i) => <Line key={y} dataKey={y} stroke={COLORS[i]} dot={false} connectNulls strokeWidth={2} />)}
              </LineChart>
            ) : (
              <BarChart data={spec.data}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey={spec.x} interval={0} angle={-30} textAnchor="end" height={60} /><YAxis width={60} /><Tooltip />
                <Bar dataKey={spec.ys[0]} fill={COLORS[0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No chart: needs a date column plus a number, or a text column plus a number</p>
      )}
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>{res.columns.map((c) => <th key={c} scope="col" className="sticky top-0 whitespace-nowrap border-b border-border bg-muted px-2 py-1">{c}</th>)}</tr>
            </thead>
            <tbody>
              {res.rows.slice(sl.start, sl.start + PAGE).map((r, i) => (
                <tr key={sl.start + i} className="odd:bg-muted/50">
                  {res.columns.map((c, j) => <td key={j} className={`whitespace-nowrap px-2 py-1 ${typeof r[j] === "number" ? "text-right tabular-nums" : ""}`}>{fmt(r[j], c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
      </div>
      <Pager total={res.rows.length} page={sl.page} size={PAGE} onPage={(p) => setPg({ res, page: p })} />
      <Citations items={res.citations} />
    </div>
  );
}
