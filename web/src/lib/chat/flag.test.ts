import { describe, expect, it } from "vitest";
import { collectNumbers, extractNumbers, flagUnsourcedNumbers } from "./flag";

const vals = (t: string) => extractNumbers(t).map((n) => n.value);
const flagged = (t: string, r: unknown[], u = "") => flagUnsourcedNumbers(t, r, u).map((f) => f.raw);

describe("extractNumbers", () => {
  it("reads thousands separators and decimals", () => {
    expect(vals("GDP was 1,234,567.5 and 3.14")).toEqual([1234567.5, 3.14]);
  });
  it("keeps percent at face value and marks it", () => {
    const [n] = extractNumbers("unemployment of 5.2% or 7 percent");
    expect(n.value).toBe(5.2);
    expect(n.percent).toBe(true);
    expect(vals("7 percent")).toEqual([7]);
  });
  it("applies scale words and abbreviations", () => {
    expect(vals("3.2 billion")).toEqual([3.2e9]);
    expect(vals("3.2bn, 450k, 1.5 million, 2 trillion")).toEqual([3.2e9, 450e3, 1.5e6, 2e12]);
  });
  it("skips list numbering, code, ids and glued tokens", () => {
    expect(vals("1. first\n2) second")).toEqual([]);
    expect(vals("`LIMIT 10` and ```sql\nSELECT 2015\n```")).toEqual([]);
    expect(vals("G20, Q1, 3D, 2nd, ilostat:UNE_2015")).toEqual([]);
  });
  it("does not take a sentence-final period as a decimal", () => {
    expect(vals("It was 42.")).toEqual([42]);
  });
});

describe("collectNumbers", () => {
  it("walks nested json and numbers inside strings", () => {
    expect(collectNumbers({ a: [1, -2.5], b: "2015-03" }).sort()).toEqual([1, 2.5, 3, 2015].sort());
  });
});

describe("flagUnsourcedNumbers", () => {
  const res = [{ columns: ["period", "value"], rows: [["2020", 5.23], ["2021", 1234567]], citations: [] }];

  it("passes numbers that appear in a tool result", () => {
    expect(flagged("In 2020 it was 5.23 and 1,234,567 in 2021.", res)).toEqual([]);
  });
  it("flags an injected number", () => {
    expect(flagged("Unemployment was 9.87 in 2020.", res)).toEqual(["9.87"]);
  });
  it("tolerates rounding to the displayed decimals", () => {
    expect(flagged("About 5.2% in 2020", res)).toEqual([]);
    expect(flagged("About 5.3% in 2020", res)).toEqual(["5.3%"]);
  });
  it("tolerates scaling and rounded big integers", () => {
    expect(flagged("roughly 1.2 million", res)).toEqual([]);
    expect(flagged("roughly 1,235,000", res)).toEqual([]);
    expect(flagged("roughly 9 million", res)).toEqual(["9 million"]);
  });
  it("matches a quoted scale against data held in other units", () => {
    expect(flagged("3.2 billion", [{ rows: [[3200]] }])).toEqual([]);
    expect(flagged("3.2 billion", [{ rows: [[3200000000]] }])).toEqual([]);
  });
  it("matches a percent against a ratio", () => {
    expect(flagged("grew 5.2%", [{ rows: [[0.052]] }])).toEqual([]);
  });
  it("accepts years present in tool results, flags years that are not", () => {
    expect(flagged("in 2020", res)).toEqual([]);
    expect(flagged("in 2031", res)).toEqual(["2031"]);
  });
  it("accepts numbers from the user's own question", () => {
    expect(flagged("the top 25 countries", res, "show me the top 25")).toEqual([]);
  });
  it("ignores list numbering, code and tiny bare integers", () => {
    expect(flagged("1. one\n2. two\nwe used 3 series, `LIMIT 500`", res)).toEqual([]);
  });
  it("flags everything when there are no tool results", () => {
    expect(flagged("India's rate is 7.8%", [])).toEqual(["7.8%"]);
  });
  it("reports offsets usable for highlighting", () => {
    const t = "x 9.87 y";
    const [f] = flagUnsourcedNumbers(t, res);
    expect(t.slice(f.start, f.end)).toBe("9.87");
  });
  it("handles negatives by magnitude", () => {
    expect(flagged("fell -5.23", res)).toEqual([]);
  });
});
