import { beforeEach, describe, expect, it, vi } from "vitest";

const sqls: string[] = [];
vi.mock("./client", () => ({
  describe: async (id: string) => ({ unit: "x", source_id: "s", citation: { source_name: `Src ${id}`, dataset_id: "d", retrieved_at: "2026-11-01T00:00:00Z" } }),
  relatedSeries: async () => ({ hits: [{ series_id: "s:d:rel:IND", title: "Female thing" }] }),
  sql: async (text: string) => {
    sqls.push(text);
    if (text.includes("list(DISTINCT sx)")) return { columns: ["k", "title", "dk", "sx"], rows: [["s:d:split", "Split series", "SEX", ["M", "F", "T"]]] };
    if (text.includes("FROM series WHERE")) return { columns: ["k", "title"], rows: [] };
    return { columns: ["t", "v", "freq", "unit", "um"], rows: [["2020", 5, "A", "x", null]] };
  },
}));
vi.mock("./data", () => ({
  geoName: (_n: unknown, g: string) => g,
  geoNames: async () => new Map(),
  seriesShape: async () => ({ dims: { SEX: ["M", "F", "T"] } }),
  geoLatest: vi.fn(async () => ({ rows: [{ geo: "IND", v: 5 }] })),
}));

import { loadDrill } from "./country-drill-data";
import { geoLatest } from "./data";

beforeEach(() => { sqls.length = 0; vi.mocked(geoLatest).mockClear(); });

describe("loadDrill", () => {
  it("Overall filters the all-sexes code, same selection for country and rank", async () => {
    await loadDrill("s:d:k", "IND", "all", {});
    expect(vi.mocked(geoLatest).mock.calls[0][1]).toEqual({ SEX: "T" });
    expect(sqls.some((q) => q.includes("element_at(dims, 'SEX')[1], '') = 'T'"))).toBe(true);
  });
  it("related cards: 3-part id plus one geo, case-insensitive sex key, own citation", async () => {
    const d = await loadDrill("s:d:k", "IND", "female", {});
    const ids = d.related.map((r) => r.id);
    expect(ids).toContain("s:d:split");
    expect(ids).toContain("s:d:rel");
    expect(sqls.join("\n")).not.toContain("IND:IND");
    expect(sqls.some((q) => q.includes("'s:d:split:IND'") && q.includes("element_at(dims, 'SEX')[1], '') = 'F'"))).toBe(true);
    expect(d.related.every((r) => r.source.startsWith("Src s:d:") && r.source.endsWith("retrieved 2026-11-01"))).toBe(true);
  });
});
