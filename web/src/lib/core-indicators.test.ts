import { describe, expect, it } from "vitest";
import { CORE_SLOTS, resolveCore, type CoreSlot } from "./core-indicators";
import type { SeriesStat } from "./data";

const stat = (id: string, n = 2): SeriesStat => ({ id, title: id, source_id: null, geo: null, freq: "A", unit: null, unitMult: null, start: "", end: "", retrieved: "", n, points: Array.from({ length: n }, (_, i) => ({ t: String(2000 + i), v: i })) });
const slot = (s: string, ...candidates: string[]): CoreSlot => ({ slot: s, label: s, about: "", candidates });
const fake = (have: string[]) => async (ids: string[]) => Object.fromEntries(ids.filter((i) => have.includes(i)).map((i) => [i, stat(i)]));

describe("resolveCore", () => {
  const four = [slot("a", "a1", "a2"), slot("b", "b1"), slot("c", "c1"), slot("d", "d1")];
  it("takes the first candidate with data, in priority order", async () => {
    const r = await resolveCore(four, fake(["a2", "a1", "b1", "c1"]));
    expect(r.map((x) => x.stat.id)).toEqual(["a1", "b1", "c1"]);
  });
  it("falls through to a later candidate and skips empty slots silently", async () => {
    const r = await resolveCore(four, fake(["a2", "b1", "c1"]));
    expect(r.map((x) => x.slot.slot)).toEqual(["a", "b", "c"]);
    expect(r[0].stat.id).toBe("a2");
  });
  it("ignores a candidate with no points and no headline", async () => {
    const load = async () => ({ a1: stat("a1", 0), a2: stat("a2"), b1: stat("b1"), c1: stat("c1") });
    expect((await resolveCore(four, load))[0].stat.id).toBe("a2");
  });
  it("renders nothing with fewer than 3 slots", async () => {
    expect(await resolveCore(four, fake(["a1", "b1"]))).toEqual([]);
    expect(await resolveCore(four, fake([]))).toEqual([]);
  });
  it("real slot list has 6 slots with candidates", () => {
    expect(CORE_SLOTS).toHaveLength(6);
    expect(CORE_SLOTS.every((s) => s.candidates.length > 0 && s.candidates.every((c) => c.split(":").length === 3))).toBe(true);
  });
});
