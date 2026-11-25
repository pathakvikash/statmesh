"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { decodeEvents, type ChatEvent } from "@/lib/chat/events";
import { normalizeScope, parseScopeParams, writeScopeParams, type Scope } from "@/lib/chat/scope";
import { statusText } from "@/lib/chat/speech";
import { useSpeech } from "@/lib/chat/useSpeech";
import { ANTHROPIC_MODELS, CLI_MODELS, MISSING_KEY, PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig, type ProviderKind } from "@/lib/chat/providers";
import { finishConnect, startConnect } from "@/lib/chat/openrouter-oauth";
import { ScopeBar, type GeoOpt, type SrcOpt } from "@/app/chat/scope-bar";
import { buildSharePayload, createShare, shareUrl } from "@/lib/chat/share";
import { CopyButton } from "@/components/CopyButton";
import { Answer, textOf } from "@/app/chat/answer-view";
import { FREE_CONFIG, FREE_KIND, FREE_LABEL, FREE_NOTE, freeDefault, isFree, parseQuota, presetOf, type Quota } from "./free";
import { QuotaNotice } from "./QuotaNotice";
import { buildPageContext, quickPrompts, sqlEditorText, type QuickPrompt } from "@/lib/ai-context";

type Turn = { role: "user"; text: string } | { role: "assistant"; events: ChatEvent[] };
const KEY = "statmesh.chat.settings";
const AUTO_KEY = "statmesh.chat.autosend";
const NOTE_KEY = "statmesh.chat.voicenote";
const CUSTOM = "__custom__";
const LOCAL_KINDS: ProviderKind[] = ["ollama", "lmstudio"]; // run on the user's machine
const blank: ProviderConfig = { kind: "openai", baseUrl: PRESETS.openai.baseUrl, model: "", apiKey: "" };
const STARTERS = [
  "Compare unemployment in India, Bangladesh and Vietnam",
  "CPI inflation vs policy rate",
  "US GDP trend",
];

/**
 * The chat engine, shared by /chat (full page, scope pickers, starters) and the assistant sidebar (compact:
 * no hero, no scope chips, context-aware quick prompts). Settings live under one localStorage key for both.
 */
export function ChatPanel({ sources = [], geos = [], compact = false, hosted = false, question, page = { pathname: "/chat", search: "" } }: {
  sources?: SrcOpt[]; geos?: GeoOpt[]; compact?: boolean; hosted?: boolean; question?: string; page?: { pathname: string; search: string };
}) {
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
  const [keyChecked, setKeyChecked] = useState(false);
  const [serverKey, setServerKey] = useState<Partial<Record<ProviderKind, boolean>>>({}); // env keys on the web server (never the keys)
  const [freeAvail, setFreeAvail] = useState(false); // /api/chat/free-status
  const [freeChecked, setFreeChecked] = useState(false);
  const [quota, setQuota] = useState<Quota>();
  const provRef = useRef<HTMLSelectElement>(null);
  const [orErr, setOrErr] = useState<string>(); // Connect OpenRouter result
  const [cli, setCli] = useState(false); // the claude CLI is offered only when the server is not hosted
  const stored = useRef(false);
  const chosen = useRef(false); // the user picked a provider or typed a key/model: a late free-status never overrides it
  const keyRef = useRef<HTMLInputElement>(null);
  const wantKey = useRef<"key" | "provider" | false>(false);
  const loaded = useRef(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // Browser-only persistence: the key never leaves this origin except in the per-request body.
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (s) { setCfg({ ...blank, ...JSON.parse(s) }); stored.current = true; }
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
  // Returning from openrouter.ai/auth (full page only): exchange the code, store the key like a pasted one.
  useEffect(() => {
    if (compact) return;
    void finishConnect().then((r) => {
      if (!r) return;
      setOpen(true);
      if ("error" in r) return setOrErr(r.error);
      chosen.current = stored.current = true;
      const c: ProviderConfig = { kind: "openrouter", baseUrl: PRESETS.openrouter.baseUrl, model: "", apiKey: r.key };
      setCfg((cur) => ({ ...c, model: cur.kind === "openrouter" ? cur.model : "" }));
      void loadModels(c); // the models route applies the free-models filter for openrouter
    });
  }, [compact]);
  useEffect(() => {
    fetch("/chat/models").then((r) => r.json()).then((j) => {
      const sk: Partial<Record<ProviderKind, boolean>> = j.serverKey ?? {};
      const c = j.cli === true;
      setServerKey(sk);
      setCli(c);
      // Local: default to the user's own claude plan when nothing usable is stored. A stored claude-cli choice is dropped when hosted.
      setCfg((cur) => {
        if (cur.kind === "claude-cli") return c ? cur : blank;
        const unusable = presetOf(cur.kind).keyRequired && !cur.apiKey.trim() && !sk[cur.kind];
        return c && (!stored.current || unusable) ? { kind: "claude-cli", baseUrl: "", model: "sonnet", apiKey: "" } : cur;
      });
    }).catch(() => {}).finally(() => setKeyChecked(true));
  }, []);
  useEffect(() => {
    fetch("/api/chat/free-status").then((r) => r.json()).then((j) => setFreeAvail(j?.available === true)).catch(() => {}).finally(() => setFreeChecked(true));
  }, []);
  // First load with nothing usable stored: default to the free assistant when offered. A stored free choice is dropped when it is not.
  useEffect(() => {
    if (!ready || !keyChecked || !freeChecked) return;
    setCfg((cur) => {
      const d = freeDefault(cur, { stored: stored.current, available: freeAvail, serverKey: !!serverKey[cur.kind], chosen: chosen.current });
      return d === "free" ? FREE_CONFIG : d === "blank" ? blank : cur;
    });
  }, [ready, keyChecked, freeChecked, freeAvail, serverKey]);
  // Opening the settings to ask for a key also puts the cursor in the key field.
  useEffect(() => {
    if (open && wantKey.current) { (wantKey.current === "provider" ? provRef : keyRef).current?.focus(); wantKey.current = false; }
  }, [open]);
  const askForKey = () => { if (keyRef.current) keyRef.current.focus(); else wantKey.current = "key"; setOpen(true); };
  const askForProvider = () => { if (provRef.current) provRef.current.focus(); else wantKey.current = "provider"; setOpen(true); };
  // Saves only after the load effect has run. Under StrictMode the effects run twice on mount, and a
  // save that ran before the state loaded would overwrite the stored settings with the blank default.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {}
  }, [cfg, ready]);

  // The home page links to /chat?q=... (full page only; the sidebar never takes its input from the URL)
  useEffect(() => {
    if (compact) return;
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setInput(q);
    setScope(parseScopeParams(p));
  }, [compact]);
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
    // Hidden panel (display:none) measures 0; keep the CSS min-height instead of locking a collapsed height.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
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

  // Every user edit of the provider settings goes through here (or pickKind), so the free default cannot override it.
  const edit = (c: ProviderConfig) => { chosen.current = stored.current = true; setCfg(c); };
  const pickKind = (kind: ProviderKind) => {
    chosen.current = stored.current = true;
    setQuota(undefined);
    // A hosted server cannot reach the visitor's localhost, so the local presets give no default URL there.
    if (isFree(kind)) { setCfg(FREE_CONFIG); setModels([]); setModelsErr(undefined); setCustomModel(false); return; }
    const baseUrl = hosted && LOCAL_KINDS.includes(kind) ? "" : PRESETS[kind].baseUrl;
    setCfg({ ...cfg, kind, baseUrl, model: kind === "claude-cli" ? "sonnet" : cfg.kind === "claude-cli" ? "" : cfg.model || PRESETS[kind].model });
    setModels([]);
    setModelsErr(undefined);
    setCustomModel(false);
    if (kind === "ollama" || (kind === "lmstudio" && !hosted)) void loadModels({ ...cfg, kind, baseUrl: PRESETS[kind].baseUrl });
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
    if (open && loaded.current && (cfg.kind === "ollama" || (cfg.kind === "lmstudio" && !hosted))) {
      loadModels(cfg);
    }
    // Only when the panel opens; the button reloads after the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function send(e: React.FormEvent | null, override?: string) {
    e?.preventDefault();
    const text = override ?? input;
    const bad = isFree(cfg.kind) ? null : validateConfig(serverKey[cfg.kind] && !cfg.apiKey.trim() ? { ...cfg, apiKey: "server" } : cfg);
    if (bad || !text.trim() || busy) {
      if (bad && text.trim()) bad === MISSING_KEY ? askForKey() : setOpen(true);
      return setErr(bad ?? undefined);
    }
    setErr(undefined);
    setQuota(undefined);
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
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
    // Page context is read now, so it matches what the user sees at send time. Never settings or keys.
    const pageContext = buildPageContext(page.pathname, page.search, {
      title: document.querySelector("main h1")?.textContent,
      sql: sqlEditorText.get(),
    });
    try {
      const r = await fetch("/chat/api", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: isFree(cfg.kind) ? { kind: FREE_KIND } : { ...cfg, baseUrl: resolveBaseUrl(cfg) }, messages, scope, pageContext }),
      });
      if (r.status === 429 || r.status === 503) {
        const q = parseQuota(r.status, await r.clone().json().catch(() => null));
        // Drop the sent question and its placeholder and put the text back, so a retry sends one user turn.
        if (q) { setQuota(q); setTurns(turns); setInput(text); return; } // no auto-retry; the notice offers the picker
      }
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
      if (!ctrl.signal.aborted) push([{ t: "error", message: (x as Error).message }]);
    } finally {
      if (ctrlRef.current === ctrl) setBusy(false);
    }
  }

  // Abort the stream on a real unmount. StrictMode's simulated unmount re-runs the effect synchronously, so the
  // deferred check sees alive=true again and leaves the in-flight request alone.
  const ctrlRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => { if (!alive.current) ctrlRef.current?.abort(); });
    };
  }, []);

  useEffect(() => { sendRef.current = send; });
  // `question` comes from ask(): send it once, after settings and server-key status have loaded. The ref survives
  // StrictMode's double effect; a new session remounts this component, which resets it. With no key, send() opens
  // the settings and the text stays in the composer.
  const asked = useRef(false);
  useEffect(() => {
    if (!question || asked.current || !ready || !keyChecked || !freeChecked) return;
    asked.current = true;
    setInput(question);
    ta.current?.focus();
    void sendRef.current(null, question);
  }, [question, ready, keyChecked, freeChecked]);
  const field = "w-full rounded-xl border border-border bg-background p-1.5 text-sm";
  const empty = !turns.length;
  const free = isFree(cfg.kind);
  const usingServerKey = !!serverKey[cfg.kind] && !cfg.apiKey.trim();
  const needsKey = presetOf(cfg.kind).keyRequired && !cfg.apiKey.trim() && !usingServerKey;
  const isCli = cfg.kind === "claude-cli";
  const hideFields = isCli || free;
  const modelOpts: { id: string; label: string }[] = isCli ? [...CLI_MODELS] : cfg.kind === "anthropic" ? [...ANTHROPIC_MODELS] : models.map((id) => ({ id, label: id }));
  const isCustom = !isCli && (customModel || (!!cfg.model && !modelOpts.some((m) => m.id === cfg.model)));
  const userText = turns.flatMap((t) => (t.role === "user" ? [t.text] : [])).join(" ");
  const chips: QuickPrompt[] = compact
    ? quickPrompts(buildPageContext(page.pathname, page.search))
    : STARTERS.map((text) => ({ label: text, text }));
  const pick = (c: QuickPrompt) => {
    if (c.fill) { setInput(c.text); ta.current?.focus(); } else send(null, c.text);
  };
  return (
    <div className={compact ? "flex flex-1 flex-col" : `flex min-h-[calc(100dvh-9rem)] flex-col ${empty ? "justify-center pb-16" : ""}`}>
      {empty && !compact && <h1 className="mb-6 text-center text-3xl font-semibold tracking-tight sm:text-4xl">Ask anything about the world&rsquo;s statistics</h1>}
      {/* Compact: the prompts sit above a composer pinned to the bottom of the panel. */}
      {empty && compact && <div className="flex-1" />}
      {empty && compact && <Chips chips={chips} onPick={pick} />}
      {!empty && (
        <div className={compact ? "space-y-8 pb-6 pt-2" : "mx-auto w-full max-w-3xl flex-1 space-y-8 pb-6 pt-2"} aria-live="polite">
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

      <div ref={box} className={empty && !compact ? "mx-auto w-full max-w-2xl" : "sticky bottom-0 mx-auto w-full max-w-3xl bg-background pb-4 pt-2"}>
        <div className="relative">
          {open && (
            <div role="dialog" aria-label="Model settings" className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-2xl border border-border bg-card p-4 shadow-lg">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Model settings</h2>
                <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Done</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Provider
                  <select ref={provRef} className={field} value={cfg.kind} onChange={(e) => pickKind(e.target.value as ProviderKind)}>
                    {(freeAvail || free) && <option value={FREE_KIND}>{FREE_LABEL}</option>}
                    {Object.entries(PRESETS).filter(([k]) => !isFree(k) && (k !== "claude-cli" || cli)).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </select>
                </label>
                {!free && <div className="text-sm">
                  <label className="block">Model
                    <select className={field} value={isCustom ? CUSTOM : cfg.model}
                      onChange={(e) => {
                        if (e.target.value === CUSTOM) {
                          setCustomModel(true);
                          edit({ ...cfg, model: "" });
                        } else {
                          setCustomModel(false);
                          edit({ ...cfg, model: e.target.value });
                        }
                      }}>
                      <option value="">{modelOpts.length ? "Choose a model" : "Load models first"}</option>
                      {modelOpts.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      {!isCli && <option value={CUSTOM}>Custom...</option>}
                    </select>
                    {isCustom && (
                      <input className={`${field} mt-2`} value={cfg.model} onChange={(e) => edit({ ...cfg, model: e.target.value })} placeholder="model name" aria-label="Custom model name" />
                    )}
                  </label>
                  {cfg.kind !== "anthropic" && !isCli && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <button type="button" onClick={() => loadModels(cfg)} disabled={loadingModels}
                        className="rounded-full border border-border px-2.5 py-0.5 hover:bg-muted disabled:opacity-50">
                        {loadingModels ? "Loading…" : "Load models"}
                      </button>
                      {modelsErr && <span role="alert" className="text-destructive">{modelsErr}</span>}
                    </div>
                  )}
                </div>}
                {free && <p role="note" className="rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground">{FREE_NOTE} Want more? Pick OpenRouter, OpenCode, Ollama, LM Studio or add your own key above.</p>}
                {!hideFields && <label className="text-sm">Base URL
                  <input className={field} value={cfg.baseUrl} onChange={(e) => edit({ ...cfg, baseUrl: e.target.value })} />
                </label>}
                {cfg.kind === "openrouter" && (
                  <div className="text-sm sm:col-span-2">
                    {cfg.apiKey.trim()
                      ? <button type="button" className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => { setOrErr(undefined); edit({ ...cfg, apiKey: "" }); }}>Disconnect OpenRouter</button>
                      : <button type="button" className="rounded-full border border-border px-3 py-1 hover:bg-muted" onClick={() => { setOrErr(undefined); void startConnect(window.location.origin).then((m) => m && setOrErr(m)); }}>Connect OpenRouter</button>}
                    {orErr && <span role="alert" className="ml-2 text-destructive">{orErr}</span>}
                    <p className="mt-1 text-xs text-muted-foreground">You sign in at OpenRouter; statmesh never sees your password; free models are limited by your OpenRouter account. Or paste a key below.</p>
                  </div>
                )}
                {!hideFields && <label className="text-sm">API key {presetOf(cfg.kind).keyRequired ? "" : "(optional)"}
                  <input ref={keyRef} className={field} type="password" autoComplete="off" value={cfg.apiKey} placeholder={usingServerKey ? "Using the server's key" : ""} onChange={(e) => edit({ ...cfg, apiKey: e.target.value })} />
                  {usingServerKey && <span className="mt-1 block text-xs text-muted-foreground">Using the server&apos;s key. Type a key here to use your own instead.</span>}
                </label>}
              </div>
              {speech.supported && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={autoSend} onChange={(e) => setAuto(e.target.checked)} />
                  Auto-send after speaking
                </label>
              )}
              {hosted && LOCAL_KINDS.includes(cfg.kind) && (
                <p role="note" className="mt-3 rounded-xl border border-border bg-muted px-3 py-2 text-xs">
                  This site runs on a server that can&apos;t reach your computer&apos;s localhost. To use {PRESETS[cfg.kind].label.replace(" (local)", "")} here, expose it over a public https URL (e.g. a tunnel) and paste it as the base URL. Anyone with that URL can use your {PRESETS[cfg.kind].label.replace(" (local)", "")}. Or run statmesh locally, where {PRESETS[cfg.kind].baseUrl.replace(/\/v1$/, "")} works.
                </p>
              )}
              {!hideFields && <p className="mt-3 text-xs text-muted-foreground">
                Stored in this browser&apos;s localStorage only. The statmesh web server forwards it to the model provider and
                keeps nothing. Ollama&apos;s and LM Studio&apos;s localhost addresses are resolved from the web server, not your browser.{" "}
                <button type="button" className="underline" onClick={() => edit({ ...cfg, apiKey: "" })}>Forget key</button>
              </p>}
            </div>
          )}
          {!compact && <ScopeBar scope={scope} onChange={changeScope} sources={sources} geos={geos} />}
          <form onSubmit={send} className="rounded-3xl border border-border bg-card p-3 shadow-sm focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
            <label htmlFor="q" className="sr-only">Question</label>
            <textarea id="q" ref={ta} rows={1} autoFocus={!compact} value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={empty ? "Ask about unemployment, inflation, GDP…" : "Ask a follow-up…"}
              onKeyDown={(e) => {
                if (e.key === "Escape" && speech.listening) { e.stopPropagation(); return speech.stop(); }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
              }}
              className="block min-h-9 max-h-52 w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted-foreground" />
            <div className="mt-1 flex items-center gap-2">
              <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                className="max-w-[60%] truncate rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                {free ? FREE_LABEL : `Model: ${cfg.model.trim() ? `${cfg.kind}/${cfg.model.trim()}` : "not set"}`} · Settings
              </button>
              {needsKey && !open && (
                <button type="button" onClick={askForKey} className="truncate text-xs text-accent hover:underline">Add your API key to start</button>
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
          {isCli && <p className="mt-2 px-2 text-xs text-muted-foreground">Sent to Claude through the claude CLI on this machine (your plan).</p>}
          {hosted && !hideFields && (
            <p className="mt-2 px-2 text-xs text-muted-foreground">
              Your question and this page&apos;s context are sent to your chosen model provider ({presetOf(cfg.kind).label}).
            </p>
          )}
          {free && <p className="mt-2 px-2 text-xs text-muted-foreground">{FREE_NOTE}</p>}
          {quota && <QuotaNotice resetAt={quota.resetAt} unavailable={quota.unavailable} onPick={askForProvider} />}
          {err === MISSING_KEY ? (
            <div role="alert" className="mt-2 rounded-xl border border-border bg-muted px-3 py-2 text-sm">
              <p><strong className="font-medium">{presetOf(cfg.kind).label} needs an API key.</strong> Paste one in Model settings. It is stored only in this browser&apos;s localStorage and sent with each request, never saved on the server.</p>
              {!hosted && <p className="mt-1 text-muted-foreground">No key? Pick <button type="button" className="underline hover:text-foreground" onClick={() => { pickKind("ollama"); setOpen(true); }}>Ollama (local)</button>, which runs on your machine and needs none.</p>}
              <button type="button" onClick={askForKey} className="mt-2 rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground hover:opacity-90">Open Model settings</button>
            </div>
          ) : err && <p role="alert" className="mt-2 px-2 text-sm text-destructive">{err}</p>}
        </div>
      </div>

      {empty && !compact && <Chips chips={chips} onPick={pick} />}
    </div>
  );
}

function Chips({ chips, onPick }: { chips: QuickPrompt[]; onPick: (c: QuickPrompt) => void }) {
  return (
    <div className="mx-auto mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
      {chips.map((c) => (
        <button key={c.label} type="button" onClick={() => onPick(c)} className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm hover:bg-muted">{c.label}</button>
      ))}
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
