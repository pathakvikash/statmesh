import { describe, expect, it } from "vitest";
import { clampWidth, keyWidth, maxWidth, modeValue, parseMode, parseWidth, wideWidth } from "./assistant-width";

describe("assistant width", () => {
  it("clamps to 320..min(900,70vw)", () => {
    expect(maxWidth(1000)).toBe(700);
    expect(maxWidth(2000)).toBe(900);
    expect(maxWidth(400)).toBe(320);
    expect(clampWidth(100, 1400)).toBe(320);
    expect(clampWidth(5000, 1400)).toBe(900);
    expect(clampWidth(500, 1400)).toBe(500);
  });
  it("wide is 60vw clamped", () => {
    expect(wideWidth(1000)).toBe(600);
    expect(wideWidth(2000)).toBe(900);
  });
  it("keyboard steps", () => {
    expect(keyWidth("ArrowLeft", false, 400, 1400)).toBe(424);
    expect(keyWidth("ArrowLeft", true, 400, 1400)).toBe(496);
    expect(keyWidth("ArrowRight", false, 400, 1400)).toBe(376);
    expect(keyWidth("ArrowRight", false, 330, 1400)).toBe(320);
    expect(keyWidth("Home", false, 400, 1400)).toBe(320);
    expect(keyWidth("End", false, 400, 1400)).toBe(900);
    expect(keyWidth("a", false, 400, 1400)).toBeNull();
  });
  it("parses persisted values", () => {
    expect(parseWidth(null, 1400)).toBe(400);
    expect(parseWidth("", 1400)).toBe(400);
    expect(parseWidth("abc", 1400)).toBe(400);
    expect(parseWidth("9999", 1400)).toBe(900);
    expect(parseWidth("450", 1400)).toBe(450);
    expect(parseMode("1")).toBe("open");
    expect(parseMode("rail")).toBe("rail");
    expect(parseMode("0")).toBe("closed");
    expect(parseMode(null)).toBe("closed");
    expect(parseMode(modeValue("rail"))).toBe("rail");
  });
});

import { ASSISTANT_INIT, DEFAULT_W, MODE_KEY, RAIL_W, WIDE_KEY, WIDTH_KEY } from "./assistant-width";

// Evaluates the inline init script against stubbed storage and compares with the TS helpers.
function runInit(store: Record<string, string>, vw: number) {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const root = { style: { setProperty: (k: string, v: string) => { props[k] = v; } }, setAttribute: (k: string, v: string) => { attrs[k] = v; } };
  const ls = { getItem: (k: string) => (k in store ? store[k] : null) };
  new Function("localStorage", "document", "innerWidth", ASSISTANT_INIT)(ls, { documentElement: root }, vw);
  return { w: props["--assistant-w"], mode: attrs["data-assistant"] };
}

describe("ASSISTANT_INIT matches the TS helpers", () => {
  for (const vw of [400, 1000, 1400, 2400]) {
    it(`vw ${vw}`, () => {
      expect(runInit({ [MODE_KEY]: "1" }, vw)).toEqual({ w: `${parseWidth(null, vw)}px`, mode: "open" });
      expect(runInit({ [MODE_KEY]: "1", [WIDE_KEY]: "1" }, vw).w).toBe(`${wideWidth(vw)}px`);
      for (const raw of ["500", "9999", "10", "abc"]) expect(runInit({ [MODE_KEY]: "1", [WIDTH_KEY]: raw }, vw).w).toBe(`${parseWidth(raw, vw)}px`);
      expect(runInit({ [MODE_KEY]: "rail" }, vw)).toEqual({ w: `${RAIL_W}px`, mode: "rail" });
    });
  }
  it("does nothing when closed", () => {
    expect(runInit({ [MODE_KEY]: "0" }, 1400)).toEqual({ w: undefined, mode: undefined });
    expect(DEFAULT_W).toBe(400);
  });
});
