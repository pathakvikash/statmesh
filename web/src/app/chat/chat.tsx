"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { decodeEvents, type ChatEvent } from "@/lib/chat/events";
import { normalizeScope, parseScopeParams, writeScopeParams, type Scope } from "@/lib/chat/scope";
import { statusText } from "@/lib/chat/speech";
import { useSpeech } from "@/lib/chat/useSpeech";
import { ANTHROPIC_MODELS, PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig, type ProviderKind } from "@/lib/chat/providers";
import { ScopeBar, type GeoOpt, type SrcOpt } from "./scope-bar";
import { buildSharePayload, createShare, shareUrl } from "@/lib/chat/share";
import { CopyButton } from "@/components/CopyButton";
import { Answer, textOf } from "./answer-view";

type Turn = { role: "user"; text: string } | { role: "assistant"; events: ChatEvent[] };
const KEY = "statmesh.chat.settings";
const AUTO_KEY = "statmesh.chat.autosend";
const NOTE_KEY = "statmesh.chat.voicenote";
const CUSTOM = "__custom__";
const blank: ProviderConfig ={ kind: "openai", baseUrl: PRESETS.openai.baseUrl, model: "", apiKey: "" };
const STARTERS = [
  "Compare unemployment in India, Bangladesh and Vietnam",
  "CPI inflation vs policy rate",
  "US GDP trend",
];

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
  const [models, setModels] = useState<string[]>([]); // Ollama / OpenAI-compatible list from /chat/models
  const [modelsErr, setModelsErr] = useState<string>();
  const [loadingModels, setLoadingModels] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [ready, setReady] = useState(false);
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
    setReady(true);
  }, []);
  // Saves only after the load effect has run. Under StrictMode the effects run twice on mount, and a
  // save that ran before the state loaded would overwrite the stored settings with the blank default.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {}
  }, [cfg, ready]);

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

  const pickKind = (kind: ProviderKind) => {
    setCfg({ ...cfg, kind, baseUrl: PRESETS[kind].baseUrl });
    setModels([]);
    setModelsErr(undefined);
    setCustomModel(false);
    if (kind === "ollama") void loadModels({ ...cfg, kind, baseUrl: PRESETS[kind].baseUrl });
  };

  async function loadModels(c: ProviderConfig) {
    setLoadingModels(true);
    setModelsErr(undefined);
    try {
      const r = await fetch("/chat/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { ...c, baseUrl: resolveBaseUrl(c) } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not load models.");
      setModels(j.models ?? []);
    } catch (x) {
      setModels([]);
      setModelsErr((x as Error).message);
    } finally {
      setLoadingModels(false);
    }
  }

  // Ollama is local and free to ask, so its list loads when the panel opens. Other providers load on demand.
  useEffect(() => {
    if (open && loaded.current && cfg.kind === "ollama") {
      loadModels(cfg);
    }
    // Only when the panel opens; the button reloads after the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
  const modelOpts: { id: string; label: string }[] = cfg.kind === "anthropic" ? [...ANTHROPIC_MODELS] : models.map((id) => ({ id, label: id }));
  const isCustom = customModel || (!!cfg.model && !modelOpts.some((m) => m.id === cfg.model));
  const userText = turns.flatMap((t) => (t.role === "user" ? [t.text] : [])).join(" ");
  return (
    <div className={`flex min-h-[calc(100dvh-9rem)] flex-col ${empty ? "justify-center pb-16" : ""}`}>
      {empty && <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">Ask anything about the world&rsquo;s statistics</h1>}
      {!empty && (
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 pb-6 pt-2" aria-live="polite">
          {turns.map((t, i) => t.role === "user"
            ? <div key={i} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2.5 text-sm">{t.text}</p></div>
            : (
              <div key={i}>
                <Answer events={t.events} userText={userText} busy={busy && i === turns.length - 1} />
                {!(busy && i === turns.length - 1) && textOf(t.events) && <ShareButton question={(turns[i - 1] as { text?: string } | undefined)?.text ?? ""} events={t.events} />}
              </div>
            ))}
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
                <div className="text-sm">
                  <label className="block">Model
                    <select className={field} value={isCustom ? CUSTOM : cfg.model}
                      onChange={(e) => {
                        if (e.target.value === CUSTOM) {
                          setCustomModel(true);
                          setCfg({ ...cfg, model: "" });
                        } else {
                          setCustomModel(false);
                          setCfg({ ...cfg, model: e.target.value });
                        }
                      }}>
                      <option value="">{modelOpts.length ? "Choose a model" : "Load models first"}</option>
                      {modelOpts.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      <option value={CUSTOM}>Custom...</option>
                    </select>
                    {isCustom && (
                      <input className={`${field} mt-2`} value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder="model name" aria-label="Custom model name" />
                    )}
                  </label>
                  {cfg.kind !== "anthropic" && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <button type="button" onClick={() => loadModels(cfg)} disabled={loadingModels}
                        className="rounded-full border border-border px-2.5 py-0.5 hover:bg-muted disabled:opacity-50">
                        {loadingModels ? "Loading…" : "Load models"}
                      </button>
                      {modelsErr && <span role="alert" className="text-destructive">{modelsErr}</span>}
                    </div>
                  )}
                </div>
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

/** Share is two clicks: the first shows the warning, the second creates the link. Nothing is sent before that. */
function ShareButton({ question, events }: { question: string; events: ChatEvent[] }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string>();
  async function create() {
    setState("busy");
    setErr(undefined);
    try {
      setUrl(shareUrl(window.location.origin, await createShare(buildSharePayload(question, events))));
      setState("done");
    } catch (x) {
      setErr((x as Error).message);
      setState("confirm");
    }
  }
  if (state === "idle") return <button type="button" onClick={() => setState("confirm")} className="mt-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">Share</button>;
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-sm">
      <p>Your question and this answer become public to anyone who has the link. Your model settings and API key are not included.</p>
      {state === "done" ? (
        <div className="mt-2 flex items-center gap-2">
          <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 font-mono text-xs" />
          <CopyButton text={url} label="Copy" />
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={state === "busy"} onClick={create} className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground disabled:opacity-50">{state === "busy" ? "Creating…" : "Create public link"}</button>
          <button type="button" onClick={() => setState("idle")} className="text-xs text-muted-foreground underline">Cancel</button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-destructive">{err}</p>}
    </div>
  );
}
