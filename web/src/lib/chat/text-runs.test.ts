import { describe, expect, it } from "vitest";
import type { ChatEvent } from "./events";
import { mergeTextRuns } from "./text-runs";

const txt = (text: string): ChatEvent => ({ t: "text", text });

describe("mergeTextRuns", () => {
  it("joins many tiny chunks into one text event", () => {
    const chunks = ["no", " matching", " data", ".", " I", " searched"];
    expect(mergeTextRuns(chunks.map(txt))).toEqual([txt("no matching data. I searched")]);
  });

  it("starts a new run only after a tool call, result or chart", () => {
    const ev: ChatEvent[] = [
      txt("Let me "), txt("check."),
      { t: "call", id: "1", name: "search_series", input: { q: "robotics" } },
      { t: "result", id: "1", name: "search_series", output: { hits: [] } },
      txt("No "), txt("data."),
    ];
    expect(mergeTextRuns(ev)).toEqual([
      txt("Let me check."),
      ev[2],
      ev[3],
      txt("No data."),
    ]);
  });

  it("keeps leading and trailing spaces from chunks", () => {
    expect(mergeTextRuns([txt("  a "), txt(" b  ")])).toEqual([txt("  a  b  ")]);
  });

  it("drops empty chunks and does not mutate its input", () => {
    const input = [txt("x"), txt(""), txt("y")];
    const copy = JSON.parse(JSON.stringify(input));
    expect(mergeTextRuns(input)).toEqual([txt("xy")]);
    expect(input).toEqual(copy);
  });

  it("returns an empty list for no events", () => {
    expect(mergeTextRuns([])).toEqual([]);
  });
});
