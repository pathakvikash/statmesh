"use client";
import { useState } from "react";
import { Citations } from "@/components/Citations";
import { Table } from "@/components/Table";
import type { SqlResult } from "@/lib/client";

const DEFAULT = "SELECT * FROM sources LIMIT 10";

export function Console() {
  const [sql, setSql] = useState(DEFAULT);
  const [res, setRes] = useState<SqlResult>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      const r = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) });
      const body = await r.json();
      if (r.ok) setRes(body);
      else {
        setRes(undefined);
        setErr(body.detail ?? r.statusText);
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={run} className="mb-4">
        <label htmlFor="sql" className="block text-sm font-medium">SQL</label>
        <textarea id="sql" value={sql} onChange={(e) => setSql(e.target.value)} rows={6}
          className="w-full rounded border border-slate-400 p-2 font-mono text-sm" spellCheck={false} />
        <button disabled={busy} className="mt-2 rounded bg-slate-900 px-4 py-1.5 text-white disabled:opacity-50">
          {busy ? "Running…" : "Run"}
        </button>
      </form>
      <div aria-live="polite">
        {err && <p role="alert" className="rounded border border-red-700 bg-red-50 p-3 text-red-900">{err}</p>}
        {res && (
          <>
            {res.warning && <p className="mb-2 rounded border border-amber-700 bg-amber-50 p-3 text-amber-900">{res.warning}</p>}
            <h2 className="mb-1 text-sm font-semibold">SQL executed</h2>
            <pre className="mb-4 overflow-x-auto rounded bg-slate-100 p-2 text-sm">{res.sql}</pre>
            <Table columns={res.columns} rows={res.rows} caption={`${res.rows.length} rows${res.truncated ? " (truncated at the row cap)" : ""}`} />
            <Citations items={res.citations} />
          </>
        )}
      </div>
    </>
  );
}
