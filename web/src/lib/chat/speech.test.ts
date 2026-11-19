import { describe, expect, it } from "vitest";
import { mergeTranscript, speechReducer, statusText } from "./speech";

describe("speechReducer", () => {
  it("idle -> listening -> idle", () => {
    const l = speechReducer({ status: "idle" }, { type: "start" });
    expect(l.status).toBe("listening");
    expect(speechReducer(l, { type: "end" })).toEqual({ status: "idle" });
  });
  it("an error survives the following end and clears on start", () => {
    const e = speechReducer({ status: "listening" }, { type: "error", code: "not-allowed" });
    expect(e.error).toMatch(/denied/);
    expect(speechReducer(e, { type: "end" })).toBe(e);
    expect(speechReducer(e, { type: "start" })).toEqual({ status: "listening" });
  });
  it("maps no-speech and network, ignores aborted", () => {
    expect(speechReducer({ status: "listening" }, { type: "error", code: "no-speech" }).error).toMatch(/No speech/);
    expect(speechReducer({ status: "listening" }, { type: "error", code: "network" }).error).toMatch(/network/);
    const l = { status: "listening" } as const;
    expect(speechReducer(l, { type: "error", code: "aborted" })).toBe(l);
  });
  it("statusText", () => {
    expect(statusText({ status: "idle" })).toBe("");
    expect(statusText({ status: "listening" })).toBe("Listening");
  });
});

describe("mergeTranscript", () => {
  it("joins base, finals and interim with single spaces", () => {
    expect(mergeTranscript("What is ", " GDP of ", " India")).toBe("What is GDP of India");
    expect(mergeTranscript("", "", "")).toBe("");
    expect(mergeTranscript("hi", "", "there")).toBe("hi there");
  });
});
