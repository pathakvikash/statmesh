"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Citations } from "@/components/Citations";
import { Table } from "@/components/Table";
import { collectEvidence } from "@/lib/chat/evidence";
import { decodeEvents, type ChatEvent } from "@/lib/chat/events";
import { flagUnsourcedNumbers } from "@/lib/chat/flag";
import { PRESETS, resolveBaseUrl, validateConfig, type ProviderConfig, type ProviderKind } from "@/lib/chat/providers";
import { formatPeriod, seriesHref, type Citation } from "@/lib/format";

type Turn = { role: "user"; text: string } | { role: "assistant"; events: ChatEvent[] };
const KEY = "statmesh.chat.settings";
const blank: ProviderConfig = { kind: "openai", baseUrl: PRESETS.openai.baseUrl, model: "", apiKey: "" };
const textOf = (ev: ChatEvent[]) => ev.flatMap((e) => (e.t === "text" ? [e.text] : [])).join("");

export function Chat() {
  const [cfg, setCfg] = useState<ProviderConfig>(blank);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const loaded = useRef(false);

  // Browser-only persistence: the key never leaves this origin except in the per-request body.
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (s) setCfg({ ...blank, ...JSON.parse(s) });
    } catch {}
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {}
  }, [cfg]);

  const pickKind = (kind: ProviderKind) => setCfg({ ...cfg, kind, baseUrl: PRESETS[kind].baseUrl });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateConfig(cfg);
    if (bad || !input.trim() || busy) return setErr(bad ?? undefined);
    setErr(undefined);
    const history: Turn[] = [...turns, { role: "user", text: input }];
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
        body: JSON.stringify({ config: { ...cfg, baseUrl: resolveBaseUrl(cfg) }, messages }),
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

  const field = "w-full rounded border border-slate-400 p-1.5 text-sm";
  return (
    <>
      <details className="mb-4 rounded border border-slate-300 p-3" open={!cfg.model}>
        <summary className="cursor-pointer font-semibold">Model settings</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
        <p className="mt-2 text-xs text-slate-600">
          Stored in this browser&apos;s localStorage only. The statmesh web server forwards it to the model provider and
          keeps nothing. Ollama&apos;s localhost address is resolved from the web server, not your browser.{" "}
          <button type="button" className="underline" onClick={() => setCfg({ ...cfg, apiKey: "" })}>Forget key</button>
        </p>
      </details>

      <div className="space-y-4" aria-live="polite">
        {turns.map((t, i) => t.role === "user"
          ? <p key={i} className="rounded bg-slate-100 p-3 text-sm"><b>You:</b> {t.text}</p>
          : <Answer key={i} events={t.events} userText={turns.filter((x) => x.role === "user").map((x) => (x as { text: string }).text).join(" ")} busy={busy && i === turns.length - 1} />)}
      </div>

      <form onSubmit={send} className="mt-4">
        <label htmlFor="q" className="block text-sm font-medium">Question</label>
        <textarea id="q" rows={3} value={input} onChange={(e) => setInput(e.target.value)} className={field}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e); }} />
        {err && <p role="alert" className="mt-1 text-sm text-red-700">{err}</p>}
        <button disabled={busy} className="mt-2 rounded bg-slate-900 px-4 py-1.5 text-white disabled:opacity-50">{busy ? "Working…" : "Ask"}</button>
      </form>
    </>
  );
}

/** Text with unsourced numbers wrapped in <mark>. */
function Flagged({ text, results, userText }: { text: string; results: unknown[]; userText: string }) {
  const flags = flagUnsourcedNumbers(text, results, userText);
  const out: React.ReactNode[] = [];
  let at = 0;
  flags.forEach((f, i) => {
    out.push(text.slice(at, f.start));
    out.push(<mark key={i} className="bg-amber-200 px-0.5" title="Not found in any tool result">{f.raw}</mark>);
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
    <section className="rounded border border-slate-300 p-3 text-sm">
      {events.map((e, i) =>
        e.t === "text" ? <Flagged key={i} text={e.text} results={ev.results} userText={userText} />
        : e.t === "error" ? <p key={i} role="alert" className="text-red-700">Error: {e.message}</p>
        : e.t === "call" ? (
          <details key={i} className="my-1 text-slate-700">
            <summary className="cursor-pointer font-mono">tool: {e.name}</summary>
            <pre className="overflow-x-auto bg-slate-50 p-2 text-xs">{JSON.stringify(e.input, null, 2)}</pre>
          </details>
        ) : null)}
      {busy && <p className="text-slate-500">…</p>}
      {flagCount > 0 && (
        <p role="status" className="mt-2 rounded border border-amber-500 bg-amber-50 p-2 text-amber-900">
          {flagCount} number{flagCount > 1 ? "s" : ""} in this answer {flagCount > 1 ? "do" : "does"} not appear in any tool result. Treat as unverified.
        </p>
      )}
      {(ev.seriesIds.length > 0 || ev.sqls.length > 0) && (
        <div className="mt-3 border-t border-slate-200 pt-2">
          {ev.seriesIds.length > 0 && (
            <>
              <h3 className="font-semibold">Series used</h3>
              <ul className="list-disc pl-5">
                {ev.seriesIds.map((id) => {
                  const m = ev.meta.get(id);
                  return (
                    <li key={id}>
                      <Link href={seriesHref(id)} className="font-mono text-blue-800 underline">{id}</Link>
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
              <pre className="overflow-x-auto bg-slate-50 p-2 text-xs">{s}</pre>
            </div>
          ))}
        </div>
      )}
      {data.map((d, i) => {
        const o = d.output as { columns?: string[]; rows?: unknown[][]; truncated?: boolean; warning?: string } | null;
        return o?.columns && o.rows ? (
          <div key={i} className="mt-3">
            <Table columns={o.columns} rows={o.rows} caption={`${d.name} result${o.truncated ? " (truncated)" : ""}`} />
            {o.warning && <p className="text-amber-800">{o.warning}</p>}
          </div>
        ) : null;
      })}
      <Citations items={ev.citations as Citation[]} />
    </section>
  );
}
