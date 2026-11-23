import { describe, expect, it } from "vitest";
import { placeLabels, nearestInDirection, nodeAria, shortLabel, whyLinked } from "./helpers";

const pts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, { id: "c", x: 5, y: 40 }, { id: "d", x: -20, y: 0 }];

describe("nearestInDirection", () => {
  it("picks the closest node in the half-plane", () => {
    expect(nearestInDirection(pts, "a", "right")).toBe("b");
    expect(nearestInDirection(pts, "a", "down")).toBe("c");
    expect(nearestInDirection(pts, "a", "left")).toBe("d");
  });
  it("returns null when nothing lies that way or id is unknown", () => {
    expect(nearestInDirection(pts, "a", "up")).toBeNull();
    expect(nearestInDirection(pts, "zz", "up")).toBeNull();
  });
});

describe("panel text", () => {
  const nodes = [{ id: "a", kind: "topic" as const, label: "Inflation", count: 3 }, { id: "b", kind: "source" as const, label: "ECB" }];
  it("aria label", () => expect(nodeAria(nodes[0])).toBe("Inflation, topic, 3 series. Press Enter for details."));
  it("why linked names the other end", () => {
    const w = whyLinked("a", nodes, [{ from: "b", to: "a", kind: "covers", reason: "ECB publishes it" }]);
    expect(w.lines).toEqual([{ text: "ECB publishes it", title: "ECB: ECB publishes it" }]);
    expect(w.summary).toBe("1 source");
  });
  it("why linked dedupes the name, groups by kind and caps at 6", () => {
    const ns = [{ id: "topic:h", kind: "topic" as const, label: "Health" },
      { id: "source:who", kind: "source" as const, label: "WHO Global Health Observatory (OData API)" },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `indicator:${i}`, kind: "indicator" as const, label: `Ind ${i}` }))];
    const es = [{ from: "source:who", to: "topic:h", kind: "topic", reason: "WHO Global Health Observatory (OData API) has 3092 series on Health" },
      ...ns.slice(2).map((n) => ({ from: "topic:h", to: n.id, kind: "covers", reason: `${n.label}: covers it` }))];
    const w = whyLinked("topic:h", ns, es);
    expect(w.summary).toBe("1 source, 8 indicators");
    expect(w.lines).toHaveLength(6);
    expect(w.lines[0].text).toBe("WHO Global Health Observatory has 3092 series on Health");
    expect(w.lines[0].title).toContain("(OData API)");
    expect(w.lines[1].text).toBe("Ind 0 covers it");
    expect(w.more).toBe(3);
  });
});

describe("shortLabel", () => {
  const src = (label: string) => ({ id: "source:x", kind: "source" as const, label });
  it("drops parentheticals and keeps short names", () => {
    expect(shortLabel(src("MoSPI eSankhyiki (Ministry of Statistics and Programme Implementation, India)"))).toBe("MoSPI eSankhyiki");
    expect(shortLabel(src("ECB"))).toBe("ECB");
  });
  it("cuts at a word boundary with an ellipsis", () => {
    const s = shortLabel(src("Federal Reserve Bank of St. Louis (Data Portal)"));
    expect(s).toBe("Federal Reserve…");
    expect(s.length).toBeLessThanOrEqual(19);
    expect(shortLabel({ id: "indicator:a", kind: "indicator", label: "Supercalifragilisticexpialidocious" })).toBe("Supercalifragilist…");
  });
});

describe("placeLabels", () => {
  const lb = (id: string, x: number, y: number) => ({ id, x, y, r: 10, text: "Some label" });
  it("keeps the first of two colliding labels, in order", () => {
    expect([...placeLabels([lb("a", 100, 100), lb("b", 110, 100)])]).toEqual(["a"]);
  });
  it("keeps well-separated labels and is deterministic", () => {
    const items = [lb("a", 50, 50), lb("b", 300, 50), lb("c", 50, 300)];
    expect([...placeLabels(items)]).toEqual(["a", "b", "c"]);
    expect(placeLabels(items)).toEqual(placeLabels(items));
  });
  it("hides a label that would sit on another node", () => {
    expect([...placeLabels([lb("a", 100, 100), { id: "b", x: 100, y: 130, r: 10, text: "x" }])]).toEqual(["b"]);
  });
});
