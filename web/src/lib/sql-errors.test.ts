import { describe, expect, it } from "vitest";
import { emptyResultHelp, explainError } from "./sql-errors";
import { FALLBACK_SCHEMA } from "./sql-schema-fallback";

const S = FALLBACK_SCHEMA;
const t = (raw: string) => explainError(raw, S);

describe("explainError, beginner wording", () => {
  it("unknown function", () => {
    const e = t('Catalog Error: Scalar Function with name sumn does not exist!');
    expect(e.title).toContain('"sumn"');
    expect(e.fix).toContain("SUM");
  });
  it("group by mistake", () => {
    const e = t('Binder Error: column "geo" must appear in the GROUP BY clause or must be part of an aggregate function');
    expect(e.title).toMatch(/GROUP BY/);
    expect(e.fix).toMatch(/aggregate|SUM/);
  });
  it("string compared with a date", () => {
    expect(t("Conversion Error: invalid date field format: \"abc\"").fix).toContain("CAST");
    expect(t("Binder Error: No function matches the given name and argument types '>=(DATE, VARCHAR)'").title).toMatch(/different kinds/);
  });
  it("only SELECT", () => {
    expect(t("only SELECT statements are allowed").title).toBe("Only SELECT is allowed.");
    expect(t("statement type DELETE is not a SELECT").fix).toMatch(/SELECT or WITH/);
  });
  it("limits", () => {
    expect(t("query exceeded 10s").fix).toMatch(/WHERE/);
    expect(t("result larger than 5000000 bytes").fix).toMatch(/Narrow the years or places/);
    expect(t("too many rows").title).toMatch(/too big/);
  });
  it("no jargon: views are tables", () => {
    const e = t("table 'observatons' is not allowed");
    expect(e.title).toBe('There is no table called "observatons".');
    expect(e.fix).toContain("Tables you can query");
    expect(e.fix + e.title).not.toMatch(/view/i);
  });
  it("unknown column and raw kept", () => {
    expect(t('Referenced column "periodstart" not found in FROM clause!').fix).toContain("period_start");
    expect(t("boom").raw).toBe("boom");
  });
});

describe("emptyResultHelp", () => {
  it("offers the place step only when there is a place filter", () => {
    expect(emptyResultHelp(true).steps).toContain("removing the place");
    expect(emptyResultHelp(false).steps).not.toContain("place");
    expect(emptyResultHelp(false).message).toContain("No rows matched");
  });
});

describe("statement errors", () => {
  it("sqlsafe's rewritten DELETE/INSERT error gets the only-SELECT help", () => {
    expect(t("only a single SELECT statement is allowed").title).toBe("Only SELECT is allowed.");
  });
  it("several statements get the one-statement help", () => {
    const e = t("exactly one statement is allowed");
    expect(e.title).toBe("Only one SELECT statement is allowed.");
    expect(e.fix).toMatch(/extra statements/);
  });
});
