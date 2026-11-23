import { describe, expect, it } from "vitest";
import { layoutGraph, mergeExpansion, MAX_NODES, toOutline, type GraphData, type GraphNode } from "./graph";
import { validateGraph, validExpandId } from "./graph-data";

const n = (id: string, count?: number): GraphNode => ({ id, kind: id.split(":")[0] as GraphNode["kind"], label: id, count });
const base: GraphData = {
  nodes: [n("topic:health", 5), n("topic:economy", 9), n("source:wb", 100), n("source:who", 40)],
  edges: [{ from: "source:wb", to: "topic:economy", kind: "topic", reason: "r" }, { from: "source:who", to: "topic:health", kind: "topic", reason: "r" }],
};
const exp = (ids: string[], parent = "topic:health"): GraphData => ({
  nodes: ids.map((i, k) => n(i, k)), edges: ids.map((i) => ({ from: parent, to: i, kind: "covers", reason: "r" })),
});
const size = { w: 400, h: 300 };

describe("layoutGraph", () => {
  it("is deterministic and stays inside the box", () => {
    const g = mergeExpansion(base, base, exp(["country:DE", "country:FR", "indicator:a:b:c"]), "topic:health");
    const a = layoutGraph(g, size), b = layoutGraph(g, size);
    expect(a).toEqual(b);
    expect(a.nodes).toHaveLength(g.nodes.length);
    for (const p of a.nodes) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0); expect(p.x + p.r).toBeLessThanOrEqual(size.w);
      expect(p.y - p.r).toBeGreaterThanOrEqual(0); expect(p.y + p.r).toBeLessThanOrEqual(size.h);
    }
  });
  it("big graph: all inside with padding, no overlap, deterministic", () => {
    const topics = Array.from({ length: 8 }, (_, i) => n(`topic:t${i}`, i * 50));
    const sources = Array.from({ length: 12 }, (_, i) => n(`source:s${i}`, i * 700));
    const g: GraphData = { nodes: [...topics, ...sources], edges: sources.map((s, i) => ({ from: s.id, to: topics[(i * 3) % 8].id, kind: "topic", reason: "r" })) };
    for (const sz of [{ w: 960, h: 560 }, { w: 480, h: 640 }]) {
      const a = layoutGraph(g, sz);
      expect(layoutGraph(g, sz)).toEqual(a);
      for (const p of a.nodes) {
        expect(p.x - p.r).toBeGreaterThanOrEqual(8); expect(p.x + p.r).toBeLessThanOrEqual(sz.w - 8);
        expect(p.y - p.r).toBeGreaterThanOrEqual(8); expect(p.y + p.r).toBeLessThanOrEqual(sz.h - 8);
      }
      for (let i = 0; i < a.nodes.length; i++) for (let j = i + 1; j < a.nodes.length; j++) {
        const p = a.nodes[i], q = a.nodes[j];
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r);
      }
    }
  });
  it("handles an empty graph", () => expect(layoutGraph({ nodes: [], edges: [] }, size).nodes).toEqual([]));
});

describe("expansion ring", () => {
  const ids = Array.from({ length: 7 }, (_, i) => `indicator:s:d:i${i}`);
  const full = mergeExpansion(base, base, exp(ids), "topic:health");
  const baseIds = new Set(base.nodes.map((x) => x.id));
  it("keeps base positions, is deterministic, stays inside, and does not overlap", () => {
    const b = layoutGraph(base, size, baseIds), a = layoutGraph(full, size, baseIds);
    expect(layoutGraph(full, size, baseIds)).toEqual(a);
    for (const p of b.nodes) expect(a.nodes.find((q) => q.id === p.id)).toMatchObject({ x: p.x, y: p.y });
    for (const p of a.nodes) {
      expect(p.x - p.r).toBeGreaterThanOrEqual(0); expect(p.x + p.r).toBeLessThanOrEqual(size.w);
      expect(p.y - p.r).toBeGreaterThanOrEqual(0); expect(p.y + p.r).toBeLessThanOrEqual(size.h);
    }
    for (let i = 0; i < a.nodes.length; i++) for (let j = i + 1; j < a.nodes.length; j++) {
      const p = a.nodes[i], q = a.nodes[j];
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r - 3);
    }
  });
  it("places children near the hub", () => {
    const a = layoutGraph(full, size, baseIds), hub = a.nodes.find((x) => x.id === "topic:health")!;
    for (const k of a.nodes.filter((x) => ids.includes(x.id))) expect(Math.hypot(k.x - hub.x, k.y - hub.y)).toBeLessThan(130);
  });
});

describe("mergeExpansion", () => {
  it("collapses the previous expansion and de-duplicates", () => {
    const first = mergeExpansion(base, base, exp(["country:DE", "country:FR"]), "topic:health");
    const second = mergeExpansion(base, first, exp(["country:FR", "country:IT", "country:IT"], "topic:economy"), "topic:economy");
    expect(second.nodes.map((x) => x.id)).toEqual([...base.nodes.map((x) => x.id), "country:FR", "country:IT"]);
    expect(second.edges.every((e) => second.nodes.some((x) => x.id === e.to))).toBe(true);
    expect(mergeExpansion(base, second, null, null).nodes).toEqual(base.nodes);
  });
  it("never exceeds the cap, dropping the lowest-count expansion nodes and keeping base", () => {
    const b: GraphData = { nodes: Array.from({ length: 55 }, (_, i) => n(`topic:t${i}`)), edges: [] };
    const m = mergeExpansion(b, b, exp(Array.from({ length: 20 }, (_, i) => `country:c${i}`)), "topic:t0");
    expect(m.nodes).toHaveLength(MAX_NODES);
    expect(m.nodes.slice(0, 55)).toEqual(b.nodes);
    expect(m.nodes.slice(55).map((x) => x.id)).toEqual(["country:c15", "country:c16", "country:c17", "country:c18", "country:c19"]);
    expect(m.truncated).toBe(true);
  });
});

describe("toOutline", () => {
  it("covers exactly the node set", () => {
    const g = mergeExpansion(base, base, exp(["country:DE", "indicator:a:b:c"]), "topic:health");
    const o = toOutline(g);
    const ids = o.flatMap((x) => [x.node.id, ...x.children.map((c) => c.id)]);
    expect(new Set(ids)).toEqual(new Set(g.nodes.map((x) => x.id)));
    expect(o.find((x) => x.node.id === "topic:health")?.children.map((c) => c.id)).toEqual(["source:who", "country:DE", "indicator:a:b:c"]);
  });
});

describe("graph-data validation", () => {
  it("accepts and rejects ids", () => {
    for (const ok of ["topic:health", "source:wb", "indicator:worldbank:WDI:SP.POP", "country:DE", "topic:a b"]) expect(validExpandId(ok)).toBe(true);
    for (const bad of ["", "topic:", "planet:x", "topic:a/b", "topic:" + "x".repeat(121), "topic:x\n..;"]) expect(validExpandId(bad)).toBe(false);
  });
  it("drops malformed nodes and dangling edges", () => {
    const g = validateGraph({
      nodes: [{ id: "topic:a", kind: "topic", label: "A" }, { id: "x", kind: "bogus", label: "X" }, null, { id: "topic:a", kind: "topic", label: "dup" }, { id: "source:s", kind: "source", label: "S", count: 3 }],
      edges: [{ from: "source:s", to: "topic:a", kind: "topic", reason: "r" }, { from: "source:s", to: "topic:gone", kind: "topic", reason: "r" }, 7],
    });
    expect(g.nodes.map((x) => x.id)).toEqual(["topic:a", "source:s"]);
    expect(g.edges).toHaveLength(1);
    expect(validateGraph("junk")).toEqual({ nodes: [], edges: [], truncated: false });
  });
});
