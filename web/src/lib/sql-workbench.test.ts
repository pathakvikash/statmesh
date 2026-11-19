import { describe, expect, it } from "vitest";
import { detectChart } from "./sql-chart";
import { toCsv } from "./sql-csv";
import { didYouMean, explainError, levenshtein } from "./sql-errors";
import { FALLBACK_SCHEMA } from "./sql-schema-fallback";
import { pushRecent, RECENT_MAX } from "./sql-store";

const S = FALLBACK_SCHEMA;

describe("error mapping", () => {
  it("levenshtein and didYouMean", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(didYouMean("valu", ["value", "unit"])).toBe("value");
    expect(didYouMean("zzzzzz", ["value", "unit"])).toBeUndefined();
  });
  it("unknown column suggests from the schema", () => {
    const e = explainError('Binder Error: Referenced column "periodstart" not found in FROM clause!', S);
    expect(e.title).toContain("periodstart");
    expect(e.fix).toContain('"period_start"');
  });
  it("unknown table suggests a view", () => {
    const e = explainError("table 'observatons' is not allowed", S);
    expect(e.title).toContain("no table or view");
    expect(e.fix).toContain('"observations"');
  });
  it("blocked, single select, timeout, caps", () => {
    expect(explainError("table function is not allowed", S).title).toMatch(/blocked/);
    expect(explainError("function 'read_csv' is not allowed", S).title).toMatch(/blocked/);
    expect(explainError("only a single SELECT statement is allowed", S).title).toMatch(/one SELECT/);
    expect(explainError("exactly one statement is allowed", S).title).toMatch(/one SELECT/);
    expect(explainError("query exceeded 10s", S).title).toMatch(/too long/);
    expect(explainError("result larger than 5000000 bytes; select less", S).title).toMatch(/too big/);
  });
  it("keeps the raw text", () => {
    expect(explainError("boom", S).raw).toBe("boom");
  });
});

describe("detectChart", () => {
  it("date plus numbers is a line chart, sorted by date", () => {
    const c = detectChart(["period_start", "a", "b"], [["2020-01-01", 2, 3], ["2019-01-01", 1, null]]);
    expect(c?.kind).toBe("line");
    expect(c?.ys).toEqual(["a", "b"]);
    expect(c?.data[0].period_start).toBe("2019-01-01");
  });
  it("text plus number is a bar chart of the top 20", () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`g${i}`, i]);
    const c = detectChart(["geo", "value"], rows);
    expect(c?.kind).toBe("bar");
    expect(c?.data).toHaveLength(20);
    expect(c?.data[0].value).toBe(29);
  });
  it("no chart for text only, four numbers, or one row", () => {
    expect(detectChart(["a", "b"], [["x", "y"], ["z", "w"]])).toBeNull();
    expect(detectChart(["d", "a", "b", "c", "e"], [["2020-01-01", 1, 2, 3, 4], ["2021-01-01", 1, 2, 3, 4]])).toBeNull();
    expect(detectChart(["geo", "value"], [["x", 1]])).toBeNull();
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines; nulls are empty; maps become JSON", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [null, { k: "v" }], ["l1\nl2", 1]])).toBe(
      'a,b\r\n"x,y","say ""hi"""\r\n,"{""k"":""v""}"\r\n"l1\nl2",1\r\n',
    );
  });
});

describe("pushRecent", () => {
  it("puts newest first, drops duplicates and caps at 20", () => {
    let l: string[] = [];
    for (let i = 0; i < 25; i++) l = pushRecent(l, `q${i}`);
    expect(l).toHaveLength(RECENT_MAX);
    expect(l[0]).toBe("q24");
    expect(pushRecent(l, "q10")[0]).toBe("q10");
    expect(pushRecent(l, "q10")).toHaveLength(RECENT_MAX);
  });
});

describe("csv formula guard", () => {
  it("prefixes dangerous string cells only", () => {
    expect(toCsv(["a"], [["=1+1"], ["+x"], ["-x"], ["@SUM(A1)"], ["\tx"], ["\rx"], ["ok"], [-5], [1.5], [null]])).toBe(
      "a\r\n'=1+1\r\n'+x\r\n'-x\r\n'@SUM(A1)\r\n'\tx\r\n\"'\rx\"\r\nok\r\n-5\r\n1.5\r\n\r\n",
    );
  });
});
