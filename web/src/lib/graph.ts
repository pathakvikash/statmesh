// Pure data/layout layer of the home-page knowledge graph (contract: GET /graph).
import { forceCollide, forceLink, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

export type NodeKind = "topic" | "source" | "indicator" | "country";
export type GraphNode = { id: string; kind: NodeKind; label: string; count?: number | null; href?: string | null; licence?: string | null };
export type GraphEdge = { from: string; to: string; kind: string; reason: string };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; truncated?: boolean };
export type Positioned = GraphNode & { x: number; y: number; r: number };

export const MAX_NODES = 60;
const PAD = 8;
const TICKS = 200;
const BASE_R: Record<NodeKind, number> = { topic: 16, source: 12, indicator: 8, country: 7 };

const radius = (n: GraphNode) => BASE_R[n.kind] + Math.min(8, Math.log10(1 + Math.max(0, n.count ?? 0)) * 2);

type SimNode = SimulationNodeDatum & { id: string; r: number };

const TAU = 2 * Math.PI;
const RX_MARGIN = 72; // room for side labels
const RY_MARGIN = 48; // room for labels below the outermost nodes
const circMean = (xs: number[]) => Math.atan2(xs.reduce((s, x) => s + Math.sin(x), 0), xs.reduce((s, x) => s + Math.cos(x), 0));

/** Evenly spaced slots on a ring; the cyclic assignment and rotation that keep each item closest to its wanted angle. Deterministic. */
function spread(want: number[]): number[] {
  const n = want.length;
  let best: number[] = [], bestCost = Infinity;
  for (let s = 0; s < n; s++) {
    const slot = (i: number) => (TAU * ((i + s) % n)) / n;
    const off = circMean(want.map((w, i) => w - slot(i)));
    const out = want.map((_, i) => off + slot(i));
    const cost = want.reduce((c, w, i) => c + 1 - Math.cos(w - out[i]), 0);
    if (cost < bestCost - 1e-9) { best = out; bestCost = cost; }
  }
  return best;
}

/**
 * Deterministic. Base nodes (all of g, or those in baseIds): topics on an inner ring (by id), sources on an outer ring near their topics (pinned),
 * others relaxed around their parent. Nodes outside baseIds (an expansion) fan out on a ring around their hub and never move the base.
 */
export function layoutGraph(g: GraphData, size: { w: number; h: number }, baseIds?: ReadonlySet<string>): { nodes: Positioned[]; edges: GraphEdge[] } {
  const extra = baseIds ? g.nodes.filter((n) => !baseIds.has(n.id)) : [];
  if (!extra.length) return layoutBase(g, size);
  const bg: GraphData = { nodes: g.nodes.filter((n) => baseIds!.has(n.id)), edges: g.edges.filter((e) => baseIds!.has(e.from) && baseIds!.has(e.to)) };
  const base = layoutBase(bg, size);
  const at = new Map(base.nodes.map((n) => [n.id, n]));
  const ex = new Set(extra.map((n) => n.id));
  // hub = the base node most expansion edges touch
  const touch = new Map<string, number>();
  for (const e of g.edges) {
    if (ex.has(e.to) && at.has(e.from)) touch.set(e.from, (touch.get(e.from) ?? 0) + 1);
    if (ex.has(e.from) && at.has(e.to)) touch.set(e.to, (touch.get(e.to) ?? 0) + 1);
  }
  const hubId = [...touch].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  const hub = (hubId && at.get(hubId)) || { x: size.w / 2, y: size.h / 2 };
  const kids = [...extra].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = Math.atan2(hub.y - size.h / 2, hub.x - size.w / 2), ringR = Math.max(70, Math.min(90, 60 + kids.length * 3));
  const clamp = (v: number, r: number, max: number) => Math.min(Math.max(v, r + PAD), Math.max(r + PAD, max - r - PAD));
  const slot = kids.map((n, i) => {
    const a = (hub.x === size.w / 2 && hub.y === size.h / 2 ? -Math.PI / 2 : out) + (TAU * i) / kids.length, r = radius(n);
    return [clamp(hub.x + Math.cos(a) * ringR, r, size.w), clamp(hub.y + Math.sin(a) * ringR, r, size.h)] as const;
  });
  const sim: (SimNode & { k?: number })[] = [
    ...base.nodes.map((n) => ({ id: n.id, r: n.r, x: n.x, y: n.y, fx: n.x, fy: n.y })),
    ...kids.map((n, i) => ({ id: n.id, r: radius(n), x: slot[i][0], y: slot[i][1], k: i })),
  ];
  const s = forceSimulation(sim).alphaDecay(0).velocityDecay(0.5)
    .force("x", forceX<SimNode & { k?: number }>((d) => slot[d.k ?? 0]?.[0] ?? 0).strength((d) => (d.k == null ? 0 : 0.15)))
    .force("y", forceY<SimNode & { k?: number }>((d) => slot[d.k ?? 0]?.[1] ?? 0).strength((d) => (d.k == null ? 0 : 0.15)))
    .force("collide", forceCollide<SimNode>((d) => d.r + 2).strength(1).iterations(4)).stop();
  for (let t = 0; t < 150; t++) {
    s.tick();
    for (const d of sim) if (d.fx == null) { d.x = clamp(d.x ?? 0, d.r, size.w); d.y = clamp(d.y ?? 0, d.r, size.h); }
  }
  const kidPos = new Map(sim.filter((d) => d.k != null).map((d) => [d.id, d]));
  const nodes = g.nodes.map((n) => at.get(n.id) ?? { ...n, r: kidPos.get(n.id)!.r, x: kidPos.get(n.id)!.x!, y: kidPos.get(n.id)!.y! });
  const ids = new Set(g.nodes.map((n) => n.id));
  return { nodes, edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

function layoutBase(g: GraphData, size: { w: number; h: number }): { nodes: Positioned[]; edges: GraphEdge[] } {
  const { w, h } = size;
  const cx = w / 2, cy = h / 2, rx = Math.max(0, w / 2 - RX_MARGIN), ry = Math.max(0, h / 2 - RY_MARGIN);
  const ids = new Set(g.nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const byId = new Map<string, number>();
  const pos = new Map<string, [number, number]>();
  const ang = new Map<string, number>();
  const put = (id: string, a: number, f: number) => pos.set(id, [cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]);
  const ofKind = (k: NodeKind) => g.nodes.filter((n) => n.kind === k).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const topics = ofKind("topic");
  topics.forEach((n, i) => { const a = -Math.PI / 2 + (TAU * i) / topics.length; ang.set(n.id, a); put(n.id, a, 0.38); });
  const sources = ofKind("source");
  const want = sources.map((n, i) => {
    const ts = edges.map((e) => (e.from === n.id ? e.to : e.to === n.id ? e.from : null)).filter((o): o is string => !!o && ang.has(o)).map((o) => ang.get(o)!);
    return ts.length ? circMean(ts) : -Math.PI / 2 + (TAU * i) / sources.length;
  });
  const order = sources.map((_, i) => i).sort((a, b) => want[a] - want[b] || (sources[a].id < sources[b].id ? -1 : 1));
  spread(order.map((i) => want[i])).forEach((a, k) => put(sources[order[k]].id, a, 0.86));
  g.nodes.forEach((n, i) => {
    byId.set(n.id, i);
    if (pos.has(n.id)) return;
    const p = edges.map((e) => (e.from === n.id ? e.to : e.to === n.id ? e.from : null)).find((o) => o && pos.has(o));
    const [px, py] = (p && pos.get(p)) || [cx, cy];
    const a = i * 2.399963; // golden angle: spreads siblings without randomness
    pos.set(n.id, [px + Math.cos(a) * 36, py + Math.sin(a) * 36]);
  });
  const pinned = (n: GraphNode) => n.kind === "topic" || n.kind === "source";
  const sim: SimNode[] = g.nodes.map((n) => {
    const [x, y] = pos.get(n.id)!;
    return { id: n.id, r: radius(n), x, y, ...(pinned(n) ? { fx: x, fy: y } : {}) };
  });
  const links: SimulationLinkDatum<SimNode>[] = edges.map((e) => ({ source: byId.get(e.from)!, target: byId.get(e.to)! }));
  forceSimulation(sim)
    .force("link", forceLink(links).distance(50).strength(0.05))
    .force("collide", forceCollide<SimNode>((d) => d.r + 10).iterations(3))
    .stop()
    .tick(TICKS);
  const clamp = (v: number, r: number, max: number) => Math.min(Math.max(v, r + PAD), Math.max(r + PAD, max - r - PAD));
  const nodes = g.nodes.map((n, i) => ({ ...n, r: sim[i].r, x: clamp(sim[i].x ?? cx, sim[i].r, w), y: clamp(sim[i].y ?? cy, sim[i].r, h) }));
  return { nodes, edges };
}

/** Base plus one expansion: the previous expansion's nodes (not in base, not in the new one) go; base nodes never drop. */
export function mergeExpansion(base: GraphData, current: GraphData, expansion: GraphData | null, expandedId: string | null): GraphData {
  void current; void expandedId; // ponytail: the result depends only on base + new expansion, so the previous one collapses by construction.
  const baseIds = new Set(base.nodes.map((n) => n.id));
  const extra = new Map<string, GraphNode>();
  for (const n of expansion?.nodes ?? []) if (!baseIds.has(n.id) && !extra.has(n.id)) extra.set(n.id, n);
  const room = Math.max(0, MAX_NODES - base.nodes.length);
  const drop = new Set([...extra.values()].map((n, i) => ({ n, i })).sort((a, b) => (b.n.count ?? 0) - (a.n.count ?? 0) || a.i - b.i).slice(room).map((x) => x.n.id));
  const nodes = [...base.nodes, ...[...extra.values()].filter((n) => !drop.has(n.id))];
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges = [...base.edges, ...(expansion?.edges ?? [])].filter((e) => {
    const k = `${e.from}\0${e.to}\0${e.kind}`;
    if (!ids.has(e.from) || !ids.has(e.to) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { nodes, edges, truncated: base.truncated || expansion?.truncated || drop.size > 0 || undefined };
}

/** Accessible list view: each topic/source with the nodes linked to it; every node appears at least once. */
export function toOutline(g: GraphData): { node: GraphNode; children: GraphNode[]}[] {
  const by = new Map(g.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, Map<string, GraphNode>>();
  const add = (p: GraphNode, c: GraphNode) => kids.set(p.id, (kids.get(p.id) ?? new Map()).set(c.id, c));
  const isGroup = (n: GraphNode) => n.kind === "topic" || n.kind === "source";
  for (const e of g.edges) {
    const a = by.get(e.from), b = by.get(e.to);
    if (!a || !b) continue;
    if (isGroup(a) && !(isGroup(b) && a.kind === "source" && b.kind === "topic")) add(a, b);
    if (isGroup(b) && !(isGroup(a) && b.kind === "source" && a.kind === "topic")) add(b, a);
  }
  const groups = g.nodes.filter(isGroup).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "topic" ? -1 : 1));
  const out = groups.map((node) => ({ node, children: [...(kids.get(node.id)?.values() ?? [])] }));
  const listed = new Set(out.flatMap((o) => [o.node.id, ...o.children.map((c) => c.id)]));
  for (const n of g.nodes) if (!listed.has(n.id)) out.push({ node: n, children: [] });
  return out;
}
