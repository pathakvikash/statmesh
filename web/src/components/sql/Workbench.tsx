"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "@/components/ai/AssistantProvider";
import { Guided } from "./Guided";
import { Drawer } from "./Drawer";
import { Results, type RunOutcome } from "./Results";
import { SchemaBrowser } from "./SchemaBrowser";
import type { EditorApi } from "./Editor";
import type { SqlResult } from "@/lib/client";
import type { SqlSchema } from "@/lib/sql-schema";
import { loadChatConfig, loadRecent, loadSaved, pushRecent, saveRecent, saveSaved, type SavedQuery } from "@/lib/sql-store";
import { sqlEditorText } from "@/lib/ai-context";
import { looksLikeSql } from "@/lib/sql";
import { askPrompt, explainPrompt, nextTab, tabHref, type SqlTab } from "@/lib/sql-ai";

// CodeMirror is only fetched on /sql, and only in the browser.
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <div className="h-36 rounded-xl border border-border bg-card" /> });
const DEFAULT = "SELECT * FROM observations LIMIT 10";
const NOT_SQL = "That looks like a question, not SQL, and AI help is not set up here. Pick a starter query from the Templates tab, or write a SELECT.";
const btn = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

/** What the web server can run without a browser key: its own Anthropic key, or the local claude CLI. */
async function serverConfig(): Promise<Record<string, string> | null> {
  try {
    const m = (await (await fetch("/chat/models")).json()) as { serverKey?: { anthropic?: boolean }; cli?: boolean };
    if (m.serverKey?.anthropic) return { kind: "anthropic", baseUrl: "", model: "claude-sonnet-5-5", apiKey: "" };
    if (m.cli) return { kind: "claude-cli", baseUrl: "", model: "sonnet", apiKey: "" };
  } catch {}
  return null;
}

/** Asks the server to write SQL for a question. Throws a message fit for the user. */
async function askSql(config: Record<string, string> | null, question: string): Promise<string> {
  const r = await fetch("/sql/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, question }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || typeof body.sql !== "string") throw new Error(body.error ?? `Request failed (${r.status})`);
  return body.sql;
}

const TABS: { id: SqlTab; label: string }[] = [{ id: "ask", label: "Ask a question" }, { id: "sql", label: "Advanced: write SQL" }];

export function Workbench({ schema, live, canAsk = true, sources = [], geos = [], initialTab = "ask", initialSql, runOnMount = false }: { schema: SqlSchema; live: boolean; canAsk?: boolean; sources?: string[]; geos?: { code: string; name: string }[]; initialTab?: SqlTab; initialSql?: string; runOnMount?: boolean }) {
  const router = useRouter();
  const assistant = useAssistant();
  const [tab, setTabState] = useState<SqlTab>(initialTab);
  const setTab = (t: SqlTab) => {
    setTabState(t);
    router.replace(tabHref(t, window.location.search), { scroll: false });
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    const n = nextTab(e.key, tab);
    if (!n) return;
    e.preventDefault();
    setTab(n);
    document.getElementById(`sql-tab-${n}`)?.focus();
  };
  const api = useRef<EditorApi | null>(null);
  // The editor text lives here, so a template chosen while CodeMirror is still loading is applied on mount.
  const [text, setText] = useState(initialSql || DEFAULT);
  const setSql = (s: string) => { setText(s); api.current?.set(s); };
  const [out, setOut] = useState<RunOutcome>();
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  // The model config Ask sends: the saved chat settings, else a server key or the local CLI when the server has one.
  const [cfg, setCfg] = useState<Record<string, string> | null | undefined>(undefined); // undefined: still checking
  const [note, setNote] = useState<string>();
  const [ask, setAsk] = useState("");
  const [askErr, setAskErr] = useState<string>();
  const ran = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage exists only in the browser */
    setRecent(loadRecent());
    setSaved(loadSaved());
    const saved = loadChatConfig();
    setCfg(saved ?? undefined);
    if (!saved) void serverConfig().then(setCfg);
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
    setNote(undefined);
    setBusy(true);
    try {
      if (!looksLikeSql(sql)) {
        // Plain words: have the model write the SELECT and stop. The user reviews it and presses Run.
        if (cfg === undefined && canAsk) { setOut({ err: "Checking AI availability. Try again in a moment.", ms: 0, sql }); return; }
        if (!cfg || !canAsk) { setOut({ err: NOT_SQL, ms: 0, sql }); return; }
        try {
          const written = await askSql(cfg, sql);
          setSql(written);
          setNote("AI wrote this from your question; review it, then press Run.");
        } catch (e) {
          setOut({ err: (e as Error).message, ms: 0, sql });
        }
        return;
      }
      const t0 = performance.now();
      const r = await fetch("/api/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) });
      const body = await r.json().catch(() => ({}));
      setOut(r.ok ? { res: body as SqlResult, ms: performance.now() - t0, sql } : { err: String(body.detail ?? `Request failed (${r.status})`), ms: 0, sql });
      if (r.ok) setRecent((l) => { const n = pushRecent(l, sql); saveRecent(n); return n; });
    } catch (e) {
      setOut({ err: (e as Error).message, ms: 0, sql });
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
    // No model config here: the assistant panel (free in-browser/hosted model) answers; its quota notice shows there.
    // Either way the SQL is never run for the user.
    if (!(cfg && canAsk)) { assistant.ask(askPrompt(ask)); return; }
    setBusy(true);
    try {
      setSql(await askSql(cfg, ask));
      setNote("AI wrote this from your question; review it, then press Run.");
      setTab("sql"); // never run for the user: it lands in the editor
    } catch (x) {
      setAskErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const askForm = (
    <form onSubmit={writeSql} className="flex flex-wrap gap-2">
      <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Describe what you want, e.g. unemployment in Vietnam" aria-label="Ask in English"
        className="min-w-0 flex-1 basis-48 rounded-lg border border-border bg-background px-2 py-1 text-sm" />
      <button disabled={busy || !ask.trim()} className={btn}>Ask in English</button>
    </form>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="SQL page mode" onKeyDown={onTabKey} className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} id={`sql-tab-${t.id}`} role="tab" type="button" aria-selected={tab === t.id} aria-controls={`sql-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "ask" ? (
        <div role="tabpanel" id="sql-panel-ask" aria-labelledby="sql-tab-ask" className="space-y-4">
          <section className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h2 className="text-base font-semibold">Or just type your question in plain English</h2>
            {askForm}
            {askErr && <p role="alert" className="text-sm text-destructive">{askErr}</p>}
            <p className="text-xs text-muted-foreground">We write the SQL for you to look over. Nothing runs until you press Run.</p>
          </section>
          <Guided geos={geos} onRun={(q) => void run(q)} onEdit={(q) => { setSql(q); setTab("sql"); }} />
          <Results out={out} busy={busy} schema={schema} onRun={(q) => void run(q)} />
        </div>
      ) : (
        <div role="tabpanel" id="sql-panel-sql" aria-labelledby="sql-tab-sql" className="grid gap-4 lg:h-[calc(100vh-18rem)] lg:min-h-[30rem] lg:grid-cols-[280px_minmax(0,1fr)_260px]">
          <div className="flex max-h-[28rem] min-h-0 flex-col lg:max-h-none">
            <SchemaBrowser schema={schema} live={live} insert={(s) => (api.current ? api.current.insert(s) : setText((t) => t + s))} preview={(v) => run(`SELECT * FROM ${v} LIMIT 10`)} />
          </div>
          <div className="min-h-0 space-y-3 lg:overflow-y-auto">
            {askForm}
            {askErr && <p role="alert" className="text-sm text-destructive">{askErr}</p>}
            <Editor schema={schema} sources={sources} initial={text} onRun={() => run()} onChange={setText} apiRef={api} />
            {note && <p className="text-sm text-muted-foreground">{note}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => run()} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50">
                {busy ? "Running…" : "Run"} <span className="hidden text-xs opacity-70 sm:inline">Cmd/Ctrl+Enter</span>
              </button>
              <button onClick={save} className={btn}>Save</button>
              <button onClick={() => assistant.ask(explainPrompt(text))} disabled={!text.trim()} className={btn}>Explain this query in plain English</button>
            </div>
            <Results out={out} busy={busy} schema={schema} onRun={(q) => void run(q)} />
          </div>
          <div className="flex max-h-[28rem] min-h-0 flex-col lg:max-h-none">
            <Drawer saved={saved} recent={recent} sources={sources} onUse={setSql}
              onDelete={(i) => { const n = saved.filter((_, j) => j !== i); setSaved(n); saveSaved(n); }} />
          </div>
        </div>
      )}
    </div>
  );
}
