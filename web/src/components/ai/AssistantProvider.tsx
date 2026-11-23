"use client";
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cleanQuestion } from "@/lib/chat/ask";
import { AssistantPanel } from "./AssistantPanel";
import { clampWidth, DEFAULT_W, MODE_KEY, modeValue, parseMode, parseWidth, RAIL_W, WIDE_KEY, WIDTH_KEY, wideWidth, type Mode } from "./assistant-width";

type Api = { open: boolean; toggle: () => void; ask: (text: string) => void };
const Ctx = createContext<Api>({ open: false, toggle: () => {}, ask: () => {} });
export const useAssistant = () => useContext(Ctx);
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

/** Mounted once in the root layout, so the open panel and its conversation survive route changes. Cmd/Ctrl+J toggles. */
export function AssistantProvider({ hosted, children }: { hosted: boolean; children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>("closed");
  const [width, setWidth] = useState(DEFAULT_W);
  const [wide, setWide] = useState(false);
  const [vw, setVw] = useState(1280);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const open = mode === "open";
  // A new session remounts ChatPanel; `question` is sent once by that fresh instance.
  const [chat, setChat] = useState<{ session: number; question?: string }>({ session: 0 });
  // Where focus goes after the next mode change. Null on page load, so nothing steals focus.
  const focusNext = useRef<"in" | "out" | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
    const v = window.innerWidth;
    /* eslint-disable react-hooks/set-state-in-effect */
    setVw(v);
    setModeState(parseMode(read(MODE_KEY)));
    setWidth(parseWidth(read(WIDTH_KEY), v));
    setWide(read(WIDE_KEY) === "1");
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setMode = (m: Mode) => {
    if (m === mode) return;
    focusNext.current = m === "open" ? "in" : "out";
    setModeState(m);
    save(MODE_KEY, modeValue(m));
  };

  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    if (f === "in") document.querySelector<HTMLTextAreaElement>("#assistant-panel textarea")?.focus();
    if (f === "out") (document.getElementById("assistant-rail-open") ?? document.getElementById("assistant-toggle"))?.focus();
  }, [mode]);

  const eff = clampWidth(wide ? wideWidth(vw) : width, vw);

  // Lets globals.css reserve the panel's (or rail's) width on sm+ screens, so the page shifts instead of sitting under it.
  // Skipped until storage is read, so the pre-paint script's values are not wiped.
  useEffect(() => {
    if (!ready) return;
    const h = document.documentElement;
    if (mode === "closed") { h.removeAttribute("data-assistant"); h.style.removeProperty("--assistant-w"); }
    else { h.setAttribute("data-assistant", mode); h.style.setProperty("--assistant-w", `${mode === "rail" ? RAIL_W : eff}px`); }
  }, [ready, mode, eff]);
  useEffect(() => { document.documentElement.toggleAttribute("data-assistant-dragging", dragging); }, [dragging]);

  // Dragging or keys leave wide mode; pointermoves are coalesced to one state update per frame.
  const resize = (w: number, final: boolean) => {
    const apply = () => { raf.current = 0; setWide(false); setWidth(clampWidth(w, window.innerWidth)); };
    cancelAnimationFrame(raf.current);
    if (final) { apply(); save(WIDE_KEY, "0"); save(WIDTH_KEY, String(clampWidth(w, window.innerWidth))); }
    else raf.current = requestAnimationFrame(apply);
  };
  const toggleWide = () => { const w = !wide; setWide(w); save(WIDE_KEY, w ? "1" : "0"); };

  const ask = (text: string) => {
    const question = cleanQuestion(text);
    if (!question) return;
    setChat((c) => ({ session: c.session + 1, question }));
    setMode("open");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setMode(open ? "closed" : "open");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Ctx.Provider value={{ open, toggle: () => setMode(open ? "closed" : "open"), ask }}>
      {children}
      <Suspense fallback={null}>
        <AssistantPanel mode={mode} width={eff} vw={vw} wide={wide} dragging={dragging} hosted={hosted} session={chat.session} question={chat.question}
          onClose={() => setMode("closed")} onCollapse={() => setMode("rail")} onOpen={() => setMode("open")}
          onResize={resize} onDragging={setDragging} onToggleWide={toggleWide}
          onClear={() => setChat((c) => ({ session: c.session + 1 }))} />
      </Suspense>
    </Ctx.Provider>
  );
}
