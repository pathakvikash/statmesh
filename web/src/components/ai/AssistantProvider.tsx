"use client";
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AssistantPanel } from "./AssistantPanel";

const KEY = "statmesh.assistant.open";
type Api = { open: boolean; toggle: () => void };
const Ctx = createContext<Api>({ open: false, toggle: () => {} });
export const useAssistant = () => useContext(Ctx);

/** Mounted once in the root layout, so the open panel and its conversation survive route changes. Cmd/Ctrl+J toggles. */
export function AssistantProvider({ hosted, children }: { hosted: boolean; children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  // Where focus goes after the next open/close. Null on page load, so nothing steals focus.
  const focusNext = useRef<"in" | "out" | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(KEY) === "1") setOpenState(true);
    } catch {}
  }, []);

  const setOpen = (v: boolean) => {
    if (v === open) return;
    focusNext.current = v ? "in" : "out";
    setOpenState(v);
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {}
  };

  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    if (f === "in") document.querySelector<HTMLTextAreaElement>("#assistant-panel textarea")?.focus();
    if (f === "out") document.getElementById("assistant-toggle")?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen(!open) }}>
      {children}
      <Suspense fallback={null}>
        <AssistantPanel open={open} hosted={hosted} onClose={() => setOpen(false)} />
      </Suspense>
    </Ctx.Provider>
  );
}
