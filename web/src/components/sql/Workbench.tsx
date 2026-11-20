"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Drawer } from "./Drawer";
import { Results, type RunOutcome } from "./Results";
import { SchemaBrowser } from "./SchemaBrowser";
import type { EditorApi } from "./Editor";
import type { SqlResult } from "@/lib/client";
import type { SqlSchema } from "@/lib/sql-schema";
import { loadChatConfig, loadRecent, loadSaved, pushRecent, saveRecent, saveSaved, type SavedQuery } from "@/lib/sql-store";
import { sqlEditorText } from "@/lib/ai-context";

// CodeMirror is only fetched on /sql, and only in the browser.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <div className="h-36 rounded-xl border border-border bg-card" /> });
const DEFAULT = "SELECT * FROM observations LIMIT 10";
const btn = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

export function Workbench({ schema, live, canAsk = true, initialSql, runOnMount = false }: { schema: SqlSchema; live: boolean; canAsk?: boolean; initialSql?: string; runOnMount?: boolean }) {
  const api = useRef<EditorApi | null>(null);
  // The editor text lives here, so a template chosen while CodeMirror is still loading is applied on mount.
  const [text, setText] = useState(initialSql || DEFAULT);
  const setSql = (s: string) => { setText(s); api.current?.set(s); };
  const [out, setOut] = useState<RunOutcome>();
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [chat, setChat] = useState(false);
  const [ask, setAsk] = useState("");
  const [askErr, setAskErr] = useState<string>();
  const ran = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage exists only in the browser */
    setRecent(loadRecent());
    setSaved(loadSaved());
    setChat(!!loadChatConfig());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  // The assistant reads the current text from here (page context on /sql).
  useEffect(() => { sqlEditorText.set(text); }, [text]);
  useEffect(() => () => sqlEditorText.set(""), []);
  // "Open in SQL workbench" links with run=1: run once on mount.
  useEffect(() => {
    if (runOnMount && !ran.current) { ran.current = true; void run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function run(given?: string) {
    const sql = (given ?? text).trim();
    if (!sql || busy) return;
    if (given) setSql(given);
    setBusy(true);
    const t0 = performance.now();
    try {
      const r = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) });
      const body = await r.json().catch(() => ({}));
      setOut(r.ok ? { res: body as SqlResult, ms: performance.now() - t0 } : { err: String(body.detail ?? r.statusText), ms: 0 });
      if (r.ok) setRecent((l) => { const n = pushRecent(l, sql); saveRecent(n); return n; });
    } catch (e) {
      setOut({ err: (e as Error).message, ms: 0 });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const sql = text.trim();
    const name = sql && window.prompt("Name this query");
    if (!sql || !name?.trim()) return;
    const n = [{ name: name.trim(), sql }, ...saved];
    setSaved(n);
    saveSaved(n);
  }

  async function writeSql(e: React.FormEvent) {
    e.preventDefault();
    setAskErr(undefined);
    setBusy(true);
    try {
      const r = await fetch("/sql/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: loadChatConfig(), question: ask }) });
      const body = await r.json();
      if (r.ok) setSql(body.sql);
      else setAskErr(body.error ?? r.statusText);
    } catch (x) {
      setAskErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-14rem)] lg:min-h-[30rem] lg:grid-cols-[280px_minmax(0,1fr)_260px]">
      <div className="flex max-h-[28rem] min-h-0 flex-col lg:max-h-none">
        <SchemaBrowser schema={schema} live={live} insert={(s) => (api.current ? api.current.insert(s) : setText((t) => t + s))} preview={(v) => run(`SELECT * FROM ${v} LIMIT 10`)} />
      </div>
      <div className="min-h-0 space-y-3 lg:overflow-y-auto">
        {chat && canAsk && (
          <form onSubmit={writeSql} className="flex gap-2">
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Describe what you want, e.g. unemployment in Vietnam" aria-label="Write SQL from my question"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm" />
            <button disabled={busy || !ask.trim()} className={btn}>Write SQL from my question</button>
          </form>
        )}
        {askErr && <p role="alert" className="text-sm text-destructive">{askErr}</p>}
        <Editor schema={schema} initial={text} onRun={() => run()} onChange={setText} apiRef={api} />
        <div className="flex gap-2">
          <button onClick={() => run()} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50">
            {busy ? "Running…" : "Run"} <span className="hidden text-xs opacity-70 sm:inline">Cmd/Ctrl+Enter</span>
          </button>
          <button onClick={save} className={btn}>Save</button>
        </div>
        <Results out={out} busy={busy} schema={schema} />
      </div>
      <div className="flex max-h-[28rem] min-h-0 flex-col lg:max-h-none">
        <Drawer saved={saved} recent={recent} onUse={setSql}
          onDelete={(i) => { const n = saved.filter((_, j) => j !== i); setSaved(n); saveSaved(n); }} />
      </div>
    </div>
  );
}
