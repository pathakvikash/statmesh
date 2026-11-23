import { shortSourceName } from "@/lib/format";
import type { GraphEdge, GraphNode, NodeKind } from "@/lib/graph";

export type Dir = "left" | "right" | "up" | "down";
type P = { id: string; x: number; y: number };

const V: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** Id of the nearest node strictly in the arrow's half-plane; sideways drift costs double. null when none lies that way. */
export function nearestInDirection(nodes: P[], fromId: string, dir: Dir): string | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const [vx, vy] = V[dir];
  let best: string | null = null, bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === fromId) continue;
    const dx = n.x - from.x, dy = n.y - from.y;
    const along = dx * vx + dy * vy;
    if (along <= 0) continue;
    const score = along + 2 * Math.abs(dx * vy - dy * vx);
    if (score < bestScore) { best = n.id; bestScore = score; }
  }
  return best;
}

export const KIND_LABEL: Record<NodeKind, string> = { topic: "Topic", source: "Source", indicator: "Indicator", country: "Country" };

/** Accessible name for a node. */
export function nodeAria(n: GraphNode): string {
  return `${n.label}, ${KIND_LABEL[n.kind].toLowerCase()}${n.count != null ? `, ${n.count} series` : ""}. Press Enter for details.`;
}

export type WhyLine = { text: string; title: string };
export type Why = { summary: string; lines: WhyLine[]; more: number };
const KIND_ORDER: NodeKind[] = ["topic", "source", "indicator", "country"];
const PLURAL: Record<NodeKind, [string, string]> = { topic: ["topic", "topics"], source: ["source", "sources"], indicator: ["indicator", "indicators"], country: ["country", "countries"] };
export const WHY_MAX = 6;

/** "Why linked": one short line per neighbour (duplicated name stripped from the reason), grouped by kind, capped at WHY_MAX; full text in title. */
export function whyLinked(id: string, nodes: GraphNode[], edges: GraphEdge[]): Why {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const self = by.get(id);
  const seen = new Set<string>();
  const rows: { n: GraphNode; text: string; title: string }[] = [];
  for (const e of edges) {
    if (e.from !== id && e.to !== id) continue;
    const n = by.get(e.from === id ? e.to : e.from);
    if (!n || seen.has(n.id + e.reason)) continue;
    seen.add(n.id + e.reason);
    const short = shortLabel(n, 40);
    let r = e.reason.trim(), own = false;
    for (const name of [n.label, short, self?.label, self && shortLabel(self, 40), shortSourceName(n.label)]) {
      if (name && r.startsWith(name)) { r = r.slice(name.length).replace(/^[\s:\-–—]+/, ""); own = name === n.label || name === short || name === shortSourceName(n.label); break; }
    }
    rows.push({ n, text: r ? `${short}${own ? " " : ": "}${r}` : short, title: `${n.label}${e.reason ? `: ${e.reason}` : ""}` });
  }
  rows.sort((a, b) => KIND_ORDER.indexOf(a.n.kind) - KIND_ORDER.indexOf(b.n.kind) || (a.n.label < b.n.label ? -1 : a.n.label > b.n.label ? 1 : 0));
  const summary = KIND_ORDER.map((k) => [k, rows.filter((r) => r.n.kind === k).length] as const).filter(([, c]) => c)
    .map(([k, c]) => `${c} ${PLURAL[k][c === 1 ? 0 : 1]}`).join(", ");
  return { summary, lines: rows.slice(0, WHY_MAX).map(({ text, title }) => ({ text, title })), more: Math.max(0, rows.length - WHY_MAX) };
}

/** Short on-canvas label: sources lose their parenthetical, then everything is cut at a word boundary to ~18 chars. Full name stays in <title>/aria. */
export function shortLabel(n: GraphNode, max = 18): string {
  const t = (n.kind === "source" ? shortSourceName(n.label) : n.label).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1), sp = cut.lastIndexOf(" ");
  return `${(sp > 6 ? cut.slice(0, sp) : t.slice(0, max)).replace(/[\s,.;:-]+$/, "")}…`;
}

const CHAR_W = 5.8, LABEL_H = 13;
export type LabelItem = { id: string; x: number; y: number; r: number; text: string };
type Box = [number, number, number, number];
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Label box under a node (matches the SVG text placement in GraphView). */
export const labelBox = (i: LabelItem): Box => {
  const w = i.text.length * CHAR_W, top = i.y + i.r * 1.2 + 3;
  return [i.x - w / 2, top, i.x + w / 2, top + LABEL_H];
};

/** Greedy, in the given order (callers sort by importance): ids whose label fits without touching a placed label or any other node. */
export function placeLabels(items: LabelItem[]): Set<string> {
  const nodes = items.map((i): [string, Box] => [i.id, [i.x - i.r * 1.2, i.y - i.r * 1.2, i.x + i.r * 1.2, i.y + i.r * 1.2]]);
  const placed: Box[] = [], shown = new Set<string>();
  for (const it of items) {
    const b = labelBox(it);
    if (placed.some((p) => hit(p, b)) || nodes.some(([id, nb]) => id !== it.id && hit(nb, b))) continue;
    placed.push(b); shown.add(it.id);
  }
  return shown;
}
