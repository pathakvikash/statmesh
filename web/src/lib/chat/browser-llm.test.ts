import { describe, expect, it } from "vitest";
import { BROWSER_MODELS, REFUSAL, browserNote, buildMessages, factsEvent, finalizeAnswer, hasWebGPU, retrievalQuery, type Fact } from "./browser-llm";
import { flagUnsourcedNumbers } from "./flag";

const f = (o: Partial<Fact> = {}): Fact => ({ id: "wb:UNEMP:IND", title: "Unemployment rate", source: "World Bank", url: "https://data.example/x", value: 4.8312, unit: "percent", period: "2023", geo: "IND", ...o });
const flagged = (a: string, facts: Fact[] = [f()]) => flagUnsourcedNumbers(a, [factsEvent(facts).t === "result" ? facts : []]).map((x) => x.raw);

describe("number guard (shared flagger over the facts result)", () => {
  it("accepts exact, rounded, percent and the period", () => {
    expect(flagged("Unemployment was 4.8312 in 2023.")).toEqual([]);
    expect(flagged("About 4.83% [wb:UNEMP:IND, World Bank]")).toEqual([]);
    expect(flagged("Roughly 5 percent.")).toEqual([]);
  });
  it("handles scale words", () => expect(flagged("India has 1.43 billion people", [f({ value: 1428627663 })])).toEqual([]));
  it("flags a number only half a unit off, and a wrong rounding", () => {
    expect(flagged("It is 3%", [f({ value: 2.5 })])).toEqual(["3%"]);
    expect(flagged("It was 4.9")).toEqual(["4.9"]);
  });
  it("a date period does not whitelist 1, 100 or 1000", () => {
    expect(flagged("It was 100 and 1000", [f({ value: 4.8, period: "2023-01-01" })])).toEqual(["100", "1000"]);
  });
  it("checks currency-prefixed figures", () => {
    expect(flagged("Price USD9.9", [f({ value: 4.8 })])).toEqual(["9.9"]);
    expect(flagged("Price Rs9,999", [f({ value: 9999 })])).toEqual([]);
    expect(flagged("Price Rs8,888", [f({ value: 9999 })])).toEqual(["8,888"]);
  });
  it("ignores ordinals, ids and the Sources list", () => {
    expect(flagged("The 2nd highest, see wb:UNEMP:IND")).toEqual([]);
    expect(flagged(finalizeAnswer("About 4.83.", [f({ title: "Unemployment rate (2015 base)" })]), [f({ title: "Unemployment rate (2015 base)" })])).toEqual([]);
  });
  it("emits the facts as a result event", () => expect(factsEvent([f()])).toMatchObject({ t: "result", output: [{ id: "wb:UNEMP:IND" }] }));
});

describe("answer assembly", () => {
  it("appends sources with links and escapes titles", () => {
    const t = finalizeAnswer("4.83", [f({ title: "Rate [total] (%)" })]);
    expect(t).toContain("**Sources**");
    expect(t).toContain("[wb:UNEMP:IND](https://data.example/x): Rate \\[total\\] \\(%\\)");
  });
  it("adds no Sources to a refusal", () => expect(finalizeAnswer(`${REFUSAL}.`, [f()])).toBe(`${REFUSAL}.`));
  it("retrieval query: newest first, previous turn too, capped at 200", () => {
    expect(retrievalQuery(["unemployment in India", "and 2020?"])).toBe("and 2020? unemployment in India");
    expect(retrievalQuery(["a", "b", "c"])).toBe("c b");
    expect(retrievalQuery(["x".repeat(300)])).toHaveLength(200);
  });
});

describe("prompt builder", () => {
  it("includes facts, the refusal rule and the question", () => {
    const [sys, user] = buildMessages("What is unemployment in India?", [f()]);
    expect(sys.content).toContain("id=wb:UNEMP:IND");
    expect(sys.content).toContain("4.8312 percent");
    expect(sys.content).toContain(`${REFUSAL}.`);
    expect(sys.content).toMatch(/never invent numbers/i);
    expect(user).toEqual({ role: "user", content: "What is unemployment in India?" });
  });
  it("marks an empty fact list", () => expect(buildMessages("q", [])[0].content).toContain("(none)"));
});

describe("gating and copy", () => {
  it("shows only when navigator.gpu exists", () => {
    expect(hasWebGPU(undefined)).toBe(false);
    expect(hasWebGPU({})).toBe(false);
    expect(hasWebGPU({ gpu: {} })).toBe(true);
  });
  it("states the size and the privacy note", () => {
    expect(browserNote(1.6)).toMatch(/downloads about 1\.6 GB.*Nothing you type leaves your browser except the catalogue search/);
    expect(BROWSER_MODELS[0].gb).toBeLessThan(BROWSER_MODELS[1].gb);
  });
});

describe("web-llm model ids", () => {
  it("exist in the pinned library's prebuilt list", async () => {
    const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");
    const ids = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id));
    for (const m of BROWSER_MODELS) expect(ids.has(m.id)).toBe(true);
  });
});

describe("suggestions", () => {
  const f = (o: Partial<import("./browser-llm").Fact>) => ({ id: "a:b:c", title: "Population, total", source: "World Bank", url: "/x", value: null, unit: null, period: null, geo: null, ...o });
  it("builds a fact and questions from a single-value series", async () => {
    const { suggestions } = await import("./browser-llm");
    const s = suggestions([f({ value: 1428000000, unit: "persons", period: "2023", geo: "India" })]);
    expect(s.fact).toBe("Population, total: 1.428B persons in India (2023). Source: World Bank.");
    expect(s.questions[0]).toBe("How has Population, total changed over time?");
  });
  it("uses the top countries when there is no single value, and nothing when empty", async () => {
    const { suggestions } = await import("./browser-llm");
    expect(suggestions([f({ period: "2023", top: [{ geo: "India", v: 1.4e9 }, { geo: "China", v: 1.41e9 }] })]).fact).toContain("highest is India (1.4B), China (1.41B)");
    expect(suggestions([f({})])).toEqual({ fact: null, questions: [] });
  });
  it("lists the top countries and the median in the model facts", async () => {
    const { buildMessages } = await import("./browser-llm");
    const m = buildMessages("q", [f({ period: "2023", median: { value: 30, count: 190 }, top: [{ geo: "India", v: 7 }] })])[0].content;
    expect(m).toContain("median of 190 countries (computed) 30");
    expect(m).toContain("highest countries: India 7");
  });
});
