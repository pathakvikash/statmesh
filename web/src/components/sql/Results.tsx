"use client";
import { useMemo, useState } from "react";
import { Pager } from "@/components/ai/Pager";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { pageSlice } from "@/lib/chat/details";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Citations } from "@/components/Citations";
import { emptyResultHelp, explainError, type FriendlyError } from "@/lib/sql-errors";
import { dropGeoFilter, hasGeoFilter } from "@/lib/sql-builder";
import { detectChart } from "@/lib/sql-chart";
import { citedInRows, NO_CHART, partialNotice, rowsLabel } from "@/lib/sql-result";
import { fmtCell, headerLabel, nextSort, shareLink, sortRows, toCsv, type Sort } from "@/lib/sql-csv";
import { sqlWorkbenchHref } from "@/lib/ai-context";
import type { SqlResult } from "@/lib/client";
import type { SqlSchema } from "@/lib/sql-schema";

export type RunOutcome = { res?: SqlResult; err?: string; ms: number; sql?: string };
const PAGE = 50;
const COLORS = [1, 2, 3, 4, 5].map((i) => `var(--color-chart-${i})`);

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
      <button type="button" onClick={fix} className="mt-2 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium hover:bg-muted">Fix it for me</button>
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Technical message</summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono">{e.raw}</pre>
      </details>
    </div>
  );
}

export function Results({ out, busy, schema, onRun }: { out?: RunOutcome; busy: boolean; schema: SqlSchema; onRun?: (sql: string) => void }) {
  const [pg, setPg] = useState<{ res?: SqlResult; page: number }>({ page: 0 });
  const [sort, setSort] = useState<{ res?: SqlResult; s: Sort }>({ s: null });
  const [copied, setCopied] = useState("");
  const res = out?.res;
  const spec = useMemo(() => (res ? detectChart(res.columns, res.rows) : null), [res]);
  const active = sort.res === res ? sort.s : null; // a new result resets the sort
  const rows = useMemo(() => (res ? sortRows(res.rows, active) : []), [res, active]);
  if (!out) return <p className="p-3 text-sm text-muted-foreground">{busy ? "Running…" : "Run a query (Cmd/Ctrl+Enter) to see rows here."}</p>;
  if (out.err) return <ErrorBox e={explainError(out.err, schema)} sql={out.sql ?? ""} />;
  if (!res) return null;
  const page = pg.res === res ? pg.page : 0; // a new result starts on page 1
  const link = shareLink(typeof location === "undefined" ? "" : location.origin, sqlWorkbenchHref(out.sql ?? ""));
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link!);
      setCopied("Copied");
    } catch {
      window.prompt("Copy this link", link!); // clipboard blocked: let the user select and copy it
    }
    setTimeout(() => setCopied(""), 2000);
  };
  const empty = res.rows.length === 0 ? emptyResultHelp(hasGeoFilter(out.sql ?? "")) : null;
  const widened = empty && onRun ? dropGeoFilter(out.sql ?? "") : null;
  const cites = citedInRows(res);
  const notice = partialNotice(res.warning, cites);
  const sl = pageSlice(res.rows.length, page, PAGE);

  return (
    <div aria-live="polite" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{rowsLabel(res.rows.length)}</span>
        <span className="text-muted-foreground">{out.ms < 1000 ? `${Math.round(out.ms)} ms` : `${(out.ms / 1000).toFixed(1)} s`}</span>
        {res.truncated && <span className="rounded-full bg-chart-3/20 px-2 py-0.5 text-xs font-medium">Showing the first {res.rows.length.toLocaleString("en-IN")} rows. Narrow the years or places to see all.</span>}
        <span className="ml-auto flex gap-1">
          {link && <button type="button" onClick={copyLink} className="rounded-lg border border-border bg-card px-2 py-0.5 hover:bg-muted">{copied || "Copy link"}</button>}
          <button onClick={() => download("statmesh-query.csv", toCsv(res.columns, res.rows))} className="rounded-lg border border-border bg-card px-2 py-0.5 hover:bg-muted">Export CSV</button>
        </span>
      </div>
      {empty && (
        <div className="rounded-xl border border-chart-3/50 bg-chart-3/10 p-3 text-sm">
          <p>{empty.message}</p>
          <p className="mt-1">{empty.steps}</p>
          {widened && <button type="button" onClick={() => onRun!(widened)} className="mt-2 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted">Remove the place filter</button>}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-chart-3/50 bg-chart-3/10 p-2 text-sm">
          <p><span className="font-semibold">Heads up: </span>{notice.text}</p>
          {notice.datasets.length > 0 && <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">Which data</summary>{notice.datasets.join(", ")}</details>}
        </div>
      )}
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
        <p className="text-sm text-muted-foreground">{NO_CHART}</p>
      )}
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>{res.columns.map((c, j) => {
                const dir = active?.col === j ? active.dir : null;
                return (
                  <th key={c} scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} className="sticky top-0 whitespace-nowrap border-b border-border bg-muted p-0">
                    <button type="button" onClick={() => setSort({ res, s: nextSort(active, j) })} className="w-full px-2 py-1 text-left font-semibold hover:bg-border/40">
                      {headerLabel(res.columns, res.rows, c)}<span aria-hidden> {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}</span>
                    </button>
                  </th>
                );
              })}</tr>
            </thead>
            <tbody>
              {rows.slice(sl.start, sl.start + PAGE).map((r, i) => (
                <tr key={sl.start + i} className="odd:bg-muted/50">
                  {res.columns.map((c, j) => <td key={j} className={`whitespace-nowrap px-2 py-1 ${typeof r[j] === "number" ? "text-right tabular-nums" : ""}`}>{fmtCell(r[j], c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
      </div>
      <Pager total={res.rows.length} page={sl.page} size={PAGE} onPage={(p) => setPg({ res, page: p })} />
      <Citations items={cites} />
    </div>
  );
}
