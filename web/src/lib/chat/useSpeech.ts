"use client";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { mergeTranscript, speechReducer } from "./speech";

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
const ctor = (): (new () => Rec) | undefined => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
const noop = () => () => {};

type Opts = { getText: () => string; onText: (t: string) => void; onFinal?: (t: string) => void; autoSend?: boolean };

export function useSpeech(o: Opts) {
  const supported = useSyncExternalStore(noop, () => !!ctor(), () => false);
  const [state, dispatch] = useReducer(speechReducer, { status: "idle" });
  const [level, setLevel] = useState(0);
  const opts = useRef(o);
  useEffect(() => { opts.current = o; });
  const rec = useRef<Rec | null>(null);
  const meter = useRef<{ stop: () => void } | null>(null);
  const gen = useRef(0); // bumped on every start/end/unmount: a getUserMedia that resolves later is stale

  const stopMeter = useCallback(() => { meter.current?.stop(); meter.current = null; setLevel(0); }, []);

  // Level meter: its own getUserMedia stream; every track is stopped afterwards. Failure is non-fatal.
  const startMeter = useCallback(async (g: number) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (gen.current !== g || !rec.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const ac = new AudioContext();
      const an = ac.createAnalyser();
      an.fftSize = 256;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const id = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
      }, 80);
      const m = { stop: () => { clearInterval(id); stream.getTracks().forEach((t) => t.stop()); void ac.close(); } };
      meter.current = m;
    } catch { /* recognition reports permission problems itself */ }
  }, []);

  const start = useCallback(() => {
    const R = ctor();
    if (!R || rec.current) return;
    const r = new R();
    const base = opts.current.getText();
    let finals = "";
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals += " " + t; else interim += " " + t;
      }
      opts.current.onText(mergeTranscript(base, finals, interim));
    };
    r.onerror = (e) => dispatch({ type: "error", code: e.error });
    r.onend = () => {
      gen.current++;
      rec.current = null;
      stopMeter();
      dispatch({ type: "end" });
      // Interim text that never finalised is already in the textarea, so send what is there.
      const text = opts.current.getText();
      if (opts.current.autoSend && text.trim() && text !== base) opts.current.onFinal?.(text);
    };
    rec.current = r;
    dispatch({ type: "start" });
    try { r.start(); } catch { rec.current = null; dispatch({ type: "error", code: "start" }); return; }
    void startMeter(++gen.current);
  }, [startMeter, stopMeter]);

  const stop = useCallback(() => rec.current?.stop(), []);
  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);
  useEffect(() => () => { gen.current++; rec.current?.abort(); rec.current = null; meter.current?.stop(); meter.current = null; }, []);

  return { supported, state, level, listening: state.status === "listening", toggle, stop };
}
