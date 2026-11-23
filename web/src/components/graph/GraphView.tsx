"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AskAiButton } from "@/components/AskAiButton";
import { layoutGraph, mergeExpansion, toOutline, type GraphData, type GraphEdge, type GraphNode, type NodeKind, type Positioned } from "@/lib/graph";
import { KIND_LABEL, nearestInDirection, nodeAria, placeLabels, shortLabel, whyLinked, type Dir } from "./helpers";
import { chip } from "@/lib/ui";
import { shortSourceName } from "@/lib/format";

type Layout = { nodes: Positioned[]; edges: GraphEdge[] };
const FILL: Record<NodeKind, string> = { topic: "var(--color-chart-1)", source: "var(--color-chart-2)", indicator: "var(--color-chart-3)", country: "var(--color-chart-5)" };
const KINDS = Object.keys(FILL) as NodeKind[];
const ARROWS: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

function Shape({ kind, r }: { kind: NodeKind; r: number }) {
  const p = { fill: FILL[kind], stroke: "var(--color-foreground)", strokeOpacity: 0.35, strokeWidth: 1 };
  if (kind === "source") return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={3} {...p} />;
  if (kind === "indicator") return <polygon points={`0,${-r * 1.2} ${r * 1.2},0 0,${r * 1.2} ${-r * 1.2},0`} {...p} />;
  if (kind === "country") return <polygon points={`0,${-r * 1.15} ${r},${r * 0.8} ${-r},${r * 0.8}`} {...p} />;
  return <circle r={r} {...p} />;
}

export function GraphView({ base, initial, size: desktop }: { base: GraphData; initial: Layout; size: { w: number; h: number } }) {
  const [size, setSize] = useState(desktop);
  const [graph, setGraph] = useState<GraphData>(base);
  const [layout, setLayout] = useState<Layout>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const expanded = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const refs = useRef(new Map<string, SVGGElement>());
  const reduced = useRef(false);

  // List is the default on small screens and under reduced motion, until the visitor picks a view.
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)"), s = window.matchMedia("(max-width: 639px)");
    reduced.current = m.matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser media queries, unavailable on the server
    if (!touched && (m.matches || s.matches)) setView("list");
  }, [touched]);

  // Narrow screens get a taller canvas.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 639px)").matches) return;
    const sz = { w: 480, h: 640 };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser media query, unavailable on the server
    setSize(sz); setLayout(layoutGraph(base, sz));
  }, [base]);

  const baseIds = useMemo(() => new Set(base.nodes.map((n) => n.id)), [base]);
  const apply = (g: GraphData) => { setGraph(g); setLayout(layoutGraph(g, size, baseIds)); };
  const selected = layout.nodes.find((n) => n.id === sel) ?? null;
  const why = selected ? whyLinked(selected.id, layout.nodes, layout.edges) : { summary: "", lines: [], more: 0 };
  const sourceNode = selected?.kind === "indicator"
    ? layout.nodes.find((n) => n.kind === "source" && layout.edges.some((e) => (e.from === n.id && e.to === selected.id) || (e.to === n.id && e.from === selected.id))) ?? null
    : null;
  const outline = useMemo(() => toOutline(graph), [graph]);

  async function select(id: string) {
    setSel(id); setErr(null);
    const n = layout.nodes.find((x) => x.id === id);
    if (!n || n.kind === "country" || expanded.current === id) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    try {
      const res = await fetch(`/api/graph?expand=${encodeURIComponent(id)}`, { signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      const exp = (await res.json()) as GraphData;
      expanded.current = id;
      apply(mergeExpansion(base, graph, exp, id));
    } catch (e) {
      if (!ac.signal.aborted) setErr("Could not load more links for this node.");
      void e;
    }
  }
  function clear() { abort.current?.abort(); setSel(null); setErr(null); expanded.current = null; apply(mergeExpansion(base, graph, null, null)); }

  function onKey(e: React.KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void select(id); }
    else if (e.key === "Escape") clear();
    else if (ARROWS[e.key]) {
      const to = nearestInDirection(layout.nodes, id, ARROWS[e.key]);
      if (to) { e.preventDefault(); refs.current.get(to)?.focus(); }
    }
  }

  const pos = new Map(layout.nodes.map((n) => [n.id, n]));
  const rank: Record<NodeKind, number> = { topic: 0, source: 1, indicator: 2, country: 3 };
  const nodeKind = new Map(layout.nodes.map((n) => [n.id, n.kind]));
  const shown = useMemo(() => placeLabels(layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, r: n.r, text: shortLabel(n), k: rank[n.kind] }))
    .sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1))), [layout]); // eslint-disable-line react-hooks/exhaustive-deps -- rank is a constant
  // Edge labels only for edges touching the hovered / focused / selected node; one per edge, no collisions with node labels or each other.
  const edgeShown = useMemo(() => {
    const act = new Set([hoverId, focusId, sel].filter((x): x is string => !!x));
    if (!act.size) return new Set<number>();
    const at = new Map(layout.nodes.map((n) => [n.id, n]));
    const items = layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, r: n.r, text: shortLabel(n) })).sort((a, b) => rank[nodeKind.get(a.id)!] - rank[nodeKind.get(b.id)!] || (a.id < b.id ? -1 : 1));
    layout.edges.forEach((e, i) => {
      const a = at.get(e.from), b = at.get(e.to);
      if (a && b && (act.has(e.from) || act.has(e.to))) items.push({ id: `e${i}`, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12, r: 0, text: e.kind });
    });
    return new Set([...placeLabels(items)].filter((id) => id.startsWith("e")).map((id) => Number(id.slice(1))));
  }, [layout, hoverId, focusId, sel]); // eslint-disable-line react-hooks/exhaustive-deps -- rank/nodeKind derive from layout
  const trans = "transition-[opacity,transform] duration-200 motion-reduce:transition-none";
  const toggle = (v: "graph" | "list") => (
    <button type="button" aria-pressed={view === v} onClick={() => { setTouched(true); setView(v); }}
      className={`${chip} ${view === v ? "border-accent text-accent" : ""}`}>{v === "graph" ? "Graph" : "List"}</button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label="View">{toggle("graph")}{toggle("list")}</div>
        {view === "list" && <Legend />}
      </div>

      {view === "list" ? (
        <ul className="space-y-2 text-sm">
          {outline.map(({ node, children }) => (
            <li key={node.id}>
              <Item n={node} />
              {children.length > 0 && <ul className="ml-4 mt-1 list-disc space-y-1 pl-4 text-muted-foreground">{children.map((c) => <li key={c.id}><Item n={c} /></li>)}</ul>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <svg viewBox={`0 0 ${size.w} ${size.h}`} className="h-auto w-full max-h-[80vh] rounded-xl border border-border bg-card" role="group" aria-label="Knowledge graph of sources, topics and indicators">
            {layout.edges.map((e, i) => {
              const a = pos.get(e.from), b = pos.get(e.to);
              if (!a || !b) return null;
              const on = hoverEdge === i || focusId === e.from || focusId === e.to || sel === e.from || sel === e.to;
              return (
                <g key={`${e.from}-${e.to}-${i}`} className={trans} onMouseEnter={() => setHoverEdge(i)} onMouseLeave={() => setHoverEdge(null)}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-muted-foreground)" strokeOpacity={on ? 0.9 : 0.35} strokeWidth={on ? 2 : 1} />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10} />
                  {edgeShown.has(i) && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 3} textAnchor="middle" fontSize={11} fill="var(--color-foreground)" stroke="var(--color-card)" strokeWidth={3} paintOrder="stroke">{e.kind}</text>}
                </g>
              );
            })}
            {layout.nodes.map((n) => (
              <g key={n.id} ref={(el) => { if (el) refs.current.set(n.id, el); else refs.current.delete(n.id); }}
                transform={`translate(${n.x} ${n.y})`} tabIndex={0} role="button" aria-label={nodeAria(n)} aria-pressed={sel === n.id}
                className={`cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100 ${trans}`}
                onClick={() => void select(n.id)} onKeyDown={(e) => onKey(e, n.id)} onFocus={() => setFocusId(n.id)} onBlur={() => setFocusId(null)}
                onMouseEnter={() => setHoverId(n.id)} onMouseLeave={() => setHoverId(null)}>
                <title>{n.label}</title>
                <circle className="ring opacity-0" r={n.r * 1.5 + 3} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} />
                {sel === n.id && <circle r={n.r * 1.5 + 3} fill="none" stroke="var(--color-accent)" strokeWidth={2} />}
                <Shape kind={n.kind} r={n.r} />
                {(shown.has(n.id) || hoverId === n.id || focusId === n.id || sel === n.id) && (
                  <text y={n.r * 1.2 + 14} textAnchor="middle" fontSize={11} fill="var(--color-foreground)" stroke="var(--color-card)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" pointerEvents="none">{shortLabel(n)}</text>
                )}
              </g>
            ))}
          </svg>

          {!selected && (
            <aside aria-label="How to read the graph" className="self-start rounded-xl border border-border bg-card p-4 text-sm">
              <p>Select a node to see why it is connected and to load its links.</p>
              <div className="mt-3"><Legend col /></div>
            </aside>
          )}
          {selected && (
            <aside aria-label="Node details" className="fixed inset-x-0 bottom-0 z-30 max-h-[60vh] overflow-y-auto rounded-t-xl border border-border bg-card p-4 shadow-lg sm:static sm:max-h-none sm:self-start sm:rounded-xl sm:shadow-none">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold" title={selected.label}>{selected.label}</h3>
                <button type="button" onClick={clear} aria-label="Clear selection" className="text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{KIND_LABEL[selected.kind]}{selected.count != null ? ` · ${selected.count} series` : ""}</p>
              {selected.licence && <span className="mt-2 inline-block rounded-full border border-border bg-muted px-2 py-0.5 text-xs">Licence: {selected.licence}</span>}
              {sourceNode && (
                <p className="mt-2 text-xs text-muted-foreground">Source:{" "}
                  <Link href={`/sources/${encodeURIComponent(sourceNode.id.replace(/^source:/, ""))}`} title={sourceNode.label} className="text-accent hover:underline">{shortSourceName(sourceNode.label)}</Link>
                </p>
              )}
              <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Why linked{why.summary && <span className="ml-1 normal-case tracking-normal">· {why.summary}</span>}</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {why.lines.map((l) => <li key={l.title} title={l.title}>{l.text}</li>)}
                {why.more > 0 && <li className="text-xs text-muted-foreground">+{why.more} more</li>}
              </ul>
              {err && <p role="status" className="mt-2 text-xs text-destructive">{err}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.href && <Link href={selected.href} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground hover:opacity-90">Open</Link>}
                {selected.kind === "indicator" && <AskAiButton target={{ kind: "series", id: selected.id.replace(/^indicator:/, ""), title: selected.label }} />}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ col }: { col?: boolean }) {
  return (
    <ul className={`flex gap-x-3 gap-y-1 text-xs text-muted-foreground ${col ? "flex-col" : "flex-wrap"}`} aria-label="Legend">
      {KINDS.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden><Shape kind={k} r={6} /></svg>{KIND_LABEL[k]}
        </li>
      ))}
    </ul>
  );
}

function Item({ n }: { n: GraphNode }) {
  const t = <>{n.label}<span className="text-muted-foreground"> · {KIND_LABEL[n.kind]}{n.count != null ? ` · ${n.count}` : ""}</span></>;
  return n.href ? <Link href={n.href} className="text-accent hover:underline">{t}</Link> : <span>{t}</span>;
}
