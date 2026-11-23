export const MIN_W = 320;
export const DEFAULT_W = 400;
export const RAIL_W = 44;
export const STEP = 24;
export const BIG_STEP = 96;
export const WIDTH_KEY = "statmesh.assistant.width";
export const WIDE_KEY = "statmesh.assistant.wide";
export const MODE_KEY = "statmesh.assistant.open"; // "1" open, "0" closed, "rail" collapsed (old values stay valid)

export type Mode = "open" | "closed" | "rail";

export const maxWidth = (vw: number) => Math.max(MIN_W, Math.min(900, Math.floor(vw * 0.7)));
export const clampWidth = (w: number, vw: number) => Math.round(Math.min(maxWidth(vw), Math.max(MIN_W, w)));
/** Wide mode: 60vw, clamped. */
export const wideWidth = (vw: number) => clampWidth(vw * 0.6, vw);
/** Keyboard resize: ArrowLeft grows the panel (it hangs off the right edge), ArrowRight shrinks it. */
export const keyWidth = (key: string, shift: boolean, w: number, vw: number): number | null => {
  const s = shift ? BIG_STEP : STEP;
  if (key === "ArrowLeft") return clampWidth(w + s, vw);
  if (key === "ArrowRight") return clampWidth(w - s, vw);
  if (key === "Home") return MIN_W;
  if (key === "End") return maxWidth(vw);
  return null;
};
export const parseWidth = (raw: string | null, vw: number) => {
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return clampWidth(Number.isFinite(n) ? n : DEFAULT_W, vw);
};
export const parseMode = (raw: string | null): Mode => (raw === "1" ? "open" : raw === "rail" ? "rail" : "closed");
export const modeValue = (m: Mode) => (m === "open" ? "1" : m === "rail" ? "rail" : "0");

/** Inline in <head> so the page reserves the right width before first paint (sm+ only; CSS ignores it on phones). */
export const ASSISTANT_INIT = `try{var m=localStorage.getItem("${MODE_KEY}"),h=document.documentElement;if(m==="1"||m==="rail"){var v=innerWidth,x=Math.max(${MIN_W},Math.min(900,Math.floor(v*.7))),w=${DEFAULT_W};if(localStorage.getItem("${WIDE_KEY}")==="1")w=Math.round(v*.6);else{var s=parseFloat(localStorage.getItem("${WIDTH_KEY}"));if(isFinite(s))w=s}w=Math.round(Math.min(x,Math.max(${MIN_W},w)));h.style.setProperty("--assistant-w",(m==="rail"?${RAIL_W}:w)+"px");h.setAttribute("data-assistant",m==="rail"?"rail":"open")}}catch(e){}`;
