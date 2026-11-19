"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Citations } from "@/components/Citations";
import { ChartCard, ChartSkeleton } from "@/components/chat-viz/chart-card";
import { Table } from "@/components/Table";
import { collectEvidence } from "@/lib/chat/evidence";
import { decodeEvents, type ChatEvent } from "@/lib/chat/events";
import { flagUnsourcedNumbers } from "@/lib/chat/flag";
import type { ChartData } from "@/lib/chat/chart";
import { normalizeScope, parseScopeParams, writeScopeParams, type Scope } from "@/lib/chat/scope";
import { statusText } from "@/lib/chat/speech";
import { useSpeech } from "@/lib/chat/useSpeech";
import { PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig, type ProviderKind } from "@/lib/chat/providers";
import { ScopeBar, type GeoOpt, type SrcOpt } from "./scope-bar";
import { formatPeriod, seriesHref, type Citation } from "@/lib/format";

type Turn = { role: "user"; text: string } | { role: "assistant"; events: ChatEvent[] };
const KEY = "statmesh.chat.settings";
const AUTO_KEY = "statmesh.chat.autosend";
const NOTE_KEY = "statmesh.chat.voicenote";
const blank: ProviderConfig = { kind: "openai", baseUrl: PRESETS.openai.baseUrl, model: "", apiKey: "" };
const STARTERS = [
  "Compare unemployment in India, Bangladesh and Vietnam",
  "CPI inflation vs policy rate",
  "US GDP trend",
];
const textOf = (ev: ChatEvent[]) => ev.flatMap((e) => (e.t === "text" ? [e.text] : [])).join("");

export function Chat({ sources = [], geos = [] }: { sources?: SrcOpt[]; geos?: GeoOpt[] }) {
  const [cfg, setCfg] = useState<ProviderConfig>(blank);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>({});
  const [autoSend, setAutoSend] = useState(false);
  const [noteSeen, setNoteSeen] = useState(true); // true until localStorage says otherwise, so no flash
  const loaded = useRef(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // Browser-only persistence: the key never leaves this origin except in the per-request body.
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (s) setCfg({ ...blank, ...JSON.parse(s) });
    } catch {}
    try {
      setAutoSend(localStorage.getItem(AUTO_KEY) === "1");
      setNoteSeen(localStorage.getItem(NOTE_KEY) === "1");
    } catch {
      setNoteSeen(false);
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {}
  }, [cfg]);

  // The home page links to /chat?q=...
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setInput(q);
    setScope(parseScopeParams(p));
  }, []);
  const changeScope = (s: Scope) => {
    const n = normalizeScope(s);
    setScope(n);
    const u = new URL(window.location.href);
    writeScopeParams(u.searchParams, n);
    window.history.replaceState(null, "", u);
  };
  const setAuto = (v: boolean) => {
    setAutoSend(v);
    try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch {}
  };
  const dismissNote = () => {
    setNoteSeen(true);
    try { localStorage.setItem(NOTE_KEY, "1"); } catch {}
  };

  const inputRef = useRef(input);
  useEffect(() => { inputRef.current = input; });
  const sendRef = useRef<(e: React.FormEvent | null, o?: string) => void>(() => {});
  const speech = useSpeech({ getText: () => inputRef.current, onText: setInput, onFinal: (t) => sendRef.current(null, t), autoSend });
  const micStatus = statusText(speech.state);

  // Auto-grow the composer up to its max-h.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Close the settings popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pickKind = (kind: ProviderKind) => setCfg({ ...cfg, kind, baseUrl: PRESETS[kind].baseUrl });

  async function send(e: React.FormEvent | null, override?: string) {
    e?.preventDefault();
    const text = override ?? input;
    const bad = validateConfig(cfg);
    if (bad || !text.trim() || busy) {
      if (bad && text.trim()) setOpen(true);
      return setErr(bad ?? undefined);
    }
    setErr(undefined);
    const history: Turn[] = [...turns, { role: "user", text }];
    const messages = history.map((t) => ({ role: t.role, content: t.role === "user" ? t.text : textOf(t.events) }));
    setTurns([...history, { role: "assistant", events: [] }]);
    setInput("");
    setBusy(true);
    const push = (evs: ChatEvent[]) =>
      setTurns((ts) => {
        const last = ts[ts.length - 1];
        return last?.role === "assistant" ? [...ts.slice(0, -1), { role: "assistant", events: [...last.events, ...evs] }] : ts;
      });
    try {
      const r = await fetch("/chat/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ...cfg, baseUrl: resolveBaseUrl(cfg) }, messages, scope }),
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const d = decodeEvents((buf += dec.decode(value, { stream: true })));
        buf = d.rest;
        if (d.events.length) push(d.events);
      }
    } catch (x) {
      push([{ t: "error", message: (x as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { sendRef.current = send; });
  const field = "w-full rounded-xl border border-border bg-background p-1.5 text-sm";
  const empty = !turns.length;
  const needsKey = PRESETS[cfg.kind].keyRequired && !cfg.apiKey.trim();
  const userText = turns.flatMap((t) => (t.role === "user" ? [t.text] : [])).join(" ");
  return (
    <div className={`flex min-h-[calc(100dvh-9rem)] flex-col ${empty ? "justify-center pb-16" : ""}`}>
      {empty && <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">Ask anything about the world&rsquo;s statistics</h1>}
      {!empty && (
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 pb-6 pt-2" aria-live="polite">
          {turns.map((t, i) => t.role === "user"
            ? <div key={i} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2.5 text-sm">{t.text}</p></div>
            : <Answer key={i} events={t.events} userText={userText} busy={busy && i === turns.length - 1} />)}
        </div>
      )}

      <div ref={box} className={empty ? "mx-auto w-full max-w-2xl" : "sticky bottom-0 mx-auto w-full max-w-3xl bg-background pb-4 pt-2"}>
        <div className="relative">
          {open && (
            <div role="dialog" aria-label="Model settings" className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-2xl border border-border bg-card p-4 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Model settings</h2>
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Done</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Provider
                  <select className={field} value={cfg.kind} onChange={(e) => pickKind(e.target.value as ProviderKind)}>
                    {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </select>
                </label>
                <label className="text-sm">Model
                  <input className={field} value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder="model name" />
                </label>
                <label className="text-sm">Base URL
                  <input className={field} value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
                </label>
                <label className="text-sm">API key {PRESETS[cfg.kind].keyRequired ? "" : "(optional)"}
                  <input className={field} type="password" autoComplete="off" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} />
                </label>
              </div>
              {speech.supported && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={autoSend} onChange={(e) => setAuto(e.target.checked)} />
                  Auto-send after speaking
                </label>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Stored in this browser&apos;s localStorage only. The statmesh web server forwards it to the model provider and
                keeps nothing. Ollama&apos;s localhost address is resolved from the web server, not your browser.{" "}
                <button type="button" className="underline" onClick={() => setCfg({ ...cfg, apiKey: "" })}>Forget key</button>
              </p>
            </div>
          )}
          <ScopeBar scope={scope} onChange={changeScope} sources={sources} geos={geos} />
          <form onSubmit={send} className="rounded-3xl border border-border bg-card p-3 shadow-sm focus-within:border-accent">
            <label htmlFor="q" className="sr-only">Question</label>
            <textarea id="q" ref={ta} rows={1} autoFocus value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={empty ? "Ask about unemployment, inflation, GDP…" : "Ask a follow-up…"}
              onKeyDown={(e) => { if (e.key === "Escape" && speech.listening) return speech.stop(); if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e); }}
              className="block max-h-52 w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted-foreground" />
            <div className="mt-1 flex items-center gap-2">
              <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className="max-w-[60%] truncate rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                Model: {cfg.model.trim() ? `${cfg.kind}/${cfg.model.trim()}` : "not set"} · Settings
              </button>
              {needsKey && !open && (
                <button type="button" onClick={() => setOpen(true)} className="truncate text-xs text-accent hover:underline">Add your API key to start</button>
              )}
              {speech.supported && (
                <button type="button" onClick={speech.toggle} aria-pressed={speech.listening}
                  aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
                  className={`relative ml-auto grid size-9 shrink-0 place-items-center rounded-full border border-border hover:bg-muted ${speech.listening ? "animate-pulse border-accent text-accent" : "text-muted-foreground"}`}>
                  <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
              )}
              {speech.listening && (
                <span aria-hidden className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(speech.level * 100)}%` }} />
                </span>
              )}
              <button disabled={busy || !input.trim()} aria-label={busy ? "Working" : "Send"}
                className={`${speech.supported ? "" : "ml-auto "}grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40`}>
                {busy
                  ? <span aria-hidden className="size-3 rounded-sm bg-current" />
                  : <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
              </button>
            </div>
          </form>
          <p role="status" aria-live="polite" className={micStatus ? "mt-2 px-2 text-sm text-muted-foreground" : "sr-only"}>{micStatus}</p>
          {speech.supported && !noteSeen && (
            <p className="mt-2 flex items-start gap-2 px-2 text-xs text-muted-foreground">
              <span>In Chrome, your audio is sent to Google for transcription.</span>
              <button type="button" onClick={dismissNote} className="shrink-0 underline hover:text-foreground">Dismiss</button>
            </p>
          )}
          {err && <p role="alert" className="mt-2 px-2 text-sm text-destructive">{err}</p>}
        </div>
      </div>

      {empty && (
        <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
          {STARTERS.map((q) => (
            <button key={q} type="button" onClick={() => send(null, q)} className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm hover:bg-muted">{q}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** show_chart: skeleton while running, chart once the server-side result arrives. */
function ChartPart({ input, result, busy }: { input: unknown; result: unknown; busy: boolean }) {
  const o = result as Partial<ChartData> | undefined;
  if (o && Array.isArray(o.series)) return <ChartCard data={o as ChartData} />;
  if (o || !busy) return <p role="alert" className="my-2 rounded-xl border border-border p-3 text-destructive">Could not build the chart.</p>;
  const n = (input as { series?: unknown[] } | null)?.series?.length ?? 0;
  return <ChartSkeleton n={n} />;
}

/** Text with unsourced numbers wrapped in <mark>. */
function Flagged({ text, results, userText }: { text: string; results: unknown[]; userText: string }) {
  const flags = flagUnsourcedNumbers(text, results, userText);
  const out: React.ReactNode[] = [];
  let at = 0;
  flags.forEach((f, i) => {
    out.push(text.slice(at, f.start));
    out.push(<mark key={i} className="rounded bg-accent/25 px-0.5 text-foreground underline decoration-accent decoration-dotted" title="Not found in any tool result">{f.raw}</mark>);
    at = f.end;
  });
  out.push(text.slice(at));
  return <p className="whitespace-pre-wrap">{out}</p>;
}

export function Answer({ events, userText, busy }: { events: ChatEvent[]; userText: string; busy?: boolean }) {
  const ev = collectEvidence(events);
  const flagCount = flagUnsourcedNumbers(textOf(events), ev.results, userText).length;
  const data = events.filter((e): e is Extract<ChatEvent, { t: "result" }> => e.t === "result");
  return (
    <section className="space-y-3 text-[15px] leading-relaxed">
      {events.map((e, i) =>
        e.t === "text" ? <Flagged key={i} text={e.text} results={ev.results} userText={userText} />
        : e.t === "error" ? <p key={i} role="alert" className="text-destructive">Error: {e.message}</p>
        : e.t === "call" && e.name === "show_chart" ? (
          <ChartPart key={i} input={e.input} result={data.find((d) => d.id === e.id)?.output} busy={!!busy} />
        )
        : e.t === "call" ? (
          <details key={i} className="my-1 text-muted-foreground">
            <summary className="cursor-pointer font-mono">tool: {e.name}</summary>
            <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs text-foreground">{JSON.stringify(e.input, null, 2)}</pre>
          </details>
        ) : null)}
      {busy && <p className="text-muted-foreground">…</p>}
      {flagCount > 0 && (
        <p role="status" className="mt-2 rounded-lg border border-accent/40 bg-accent/10 p-2 text-sm text-foreground">
          {flagCount} number{flagCount > 1 ? "s" : ""} in this answer {flagCount > 1 ? "do" : "does"} not appear in any tool result. Treat as unverified.
        </p>
      )}
      {(ev.seriesIds.length > 0 || ev.sqls.length > 0) && (
        <div className="mt-3 border-t border-border pt-2">
          {ev.seriesIds.length > 0 && (
            <>
              <h3 className="font-semibold">Series used</h3>
              <ul className="list-disc pl-5">
                {ev.seriesIds.map((id) => {
                  const m = ev.meta.get(id);
                  return (
                    <li key={id}>
                      <Link href={seriesHref(id)} className="font-mono text-accent underline">{id}</Link>
                      {m && <> {m.title ? `${m.title}, ` : ""}unit {m.unit ?? "n/a"}, period {formatPeriod(m.start, m.end)}</>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {ev.sqls.map((s, i) => (
            <div key={i}>
              <h3 className="mt-2 font-semibold">SQL used</h3>
              <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-xs text-foreground">{s}</pre>
            </div>
          ))}
        </div>
      )}
      {data.map((d, i) => {
        const o = d.output as { columns?: string[]; rows?: unknown[][]; truncated?: boolean; warning?: string } | null;
        return o?.columns && o.rows ? (
          <div key={i} className="mt-3">
            <Table columns={o.columns} rows={o.rows} caption={`${d.name} result${o.truncated ? " (truncated)" : ""}`} />
            {o.warning && <p className="text-muted-foreground">{o.warning}</p>}
          </div>
        ) : null;
      })}
      <Citations items={ev.citations as Citation[]} />
    </section>
  );
}
