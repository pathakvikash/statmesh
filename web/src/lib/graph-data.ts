// Server-only loaders for the home-page knowledge graph.
import { unstable_cache } from "next/cache";
import { graph } from "./client";
import { coreIndicators, orElse } from "./data";
import { MAX_NODES, type GraphData, type GraphEdge, type GraphNode, type NodeKind } from "./graph";

const KINDS = new Set<NodeKind>(["topic", "source", "indicator", "country"]);
const ID = /^(topic|source|indicator|country):[\w:.\-%\s]{1,120}$/;
const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const opt = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Keeps well-formed nodes and edges only; edges whose endpoints are missing are dropped.
 * `known`: ids that exist outside this payload (an expansion's edges point at the node being expanded).
 */
export function validateGraph(raw: unknown, known: readonly string[] = []): GraphData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const nodes: GraphNode[] = [];
  const endpoints = new Set<string>(known);
  for (const x of Array.isArray(r.nodes) ? r.nodes : []) {
    const n = x as Record<string, unknown> | null;
    if (!n || !str(n.id) || !KINDS.has(n.kind as NodeKind) || !str(n.label) || ids.has(n.id)) continue;
    ids.add(n.id);
    endpoints.add(n.id);
    nodes.push({ id: n.id, kind: n.kind as NodeKind, label: n.label, count: typeof n.count === "number" ? n.count : null, href: opt(n.href), licence: opt(n.licence) });
  }
  const edges: GraphEdge[] = [];
  for (const x of Array.isArray(r.edges) ? r.edges : []) {
    const e = x as Record<string, unknown> | null;
    if (e && str(e.from) && str(e.to) && endpoints.has(e.from) && endpoints.has(e.to)) edges.push({ from: e.from, to: e.to, kind: opt(e.kind) ?? "related", reason: opt(e.reason) ?? "" });
  }
  return { nodes: nodes.slice(0, MAX_NODES), edges, truncated: r.truncated === true };
}

/** Up to 6 headline indicators linked to their source node; skipped silently when unavailable. */
async function withCore(g: GraphData): Promise<GraphData> {
  const items = await orElse("graph core indicators", coreIndicators, []);
  const nodes = [...g.nodes], edges = [...g.edges];
  const have = new Set(nodes.map((n) => n.id));
  for (const { slot, stat } of items.slice(0, 6)) {
    const id = `indicator:${stat.id}`, src = stat.source_id && `source:${stat.source_id}`;
    if (nodes.length >= MAX_NODES || have.has(id) || !src || !have.has(src)) continue;
    have.add(id);
    nodes.push({ id, kind: "indicator", label: slot.label, count: null, href: `/series/${stat.id.split("/").map(encodeURIComponent).join("/")}`, licence: null });
    edges.push({ from: src, to: id, kind: "published_by", reason: "Headline indicator" });
  }
  return { ...g, nodes, edges };
}

// Throws on failure or an empty graph, so unstable_cache never stores it.
const cached = unstable_cache(async () => {
  const g = validateGraph(await graph());
  if (!g.nodes.length) throw new Error("graph: empty");
  return withCore(g);
}, ["home-graph"], { revalidate: 300 });

export const loadBaseGraph = (): Promise<GraphData> => orElse("loadBaseGraph", cached, { nodes: [], edges: [] });

export const validExpandId = (id: string) => ID.test(id);

export async function loadExpansion(id: string): Promise<GraphData> {
  if (!validExpandId(id)) return { nodes: [], edges: [] };
  return orElse("loadExpansion", async () => validateGraph(await graph(id), [id]), { nodes: [], edges: [] });
}
