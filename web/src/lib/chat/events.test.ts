import { describe, expect, it } from "vitest";
import { decodeEvents, encodeEvent, unwrapToolOutput } from "./events";

describe("events", () => {
  it("unwraps structuredContent, JSON text and errors", () => {
    expect(unwrapToolOutput({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
    expect(unwrapToolOutput({ content: [{ type: "text", text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(unwrapToolOutput({ content: [{ type: "text", text: "boom" }], isError: true })).toEqual({ error: "boom" });
    expect(unwrapToolOutput([1])).toEqual([1]);
  });
  it("decodes a stream split mid-line", () => {
    const a = encodeEvent({ t: "text", text: "hi" });
    const b = encodeEvent({ t: "error", message: "x" });
    const first = decodeEvents(a + b.slice(0, 5));
    expect(first.events).toEqual([{ t: "text", text: "hi" }]);
    expect(decodeEvents(first.rest + b.slice(5)).events).toEqual([{ t: "error", message: "x" }]);
  });
});
