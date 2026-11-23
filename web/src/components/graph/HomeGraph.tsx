import { loadBaseGraph } from "@/lib/graph-data";
import { layoutGraph } from "@/lib/graph";
import { GraphView } from "./GraphView";

export const GRAPH_SIZE = { w: 960, h: 560 };

/** Home-page knowledge graph. Renders nothing when the graph is too small to be worth showing (or fails to load). */
export async function HomeGraph() {
  const base = await loadBaseGraph().catch(() => null);
  if (!base || base.nodes.length < 4) return null;
  const initial = layoutGraph(base, GRAPH_SIZE);
  return (
    <section aria-labelledby="explore">
      <h2 id="explore" className="mb-1 text-xl font-semibold tracking-tight">Explore the data</h2>
      <p className="mb-4 text-sm text-muted-foreground">Sources, topics and the indicators that link them. Click a node to see why it is connected.</p>
      <GraphView base={base} initial={initial} size={GRAPH_SIZE} />
    </section>
  );
}
