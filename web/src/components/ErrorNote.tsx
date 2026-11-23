/** Inline error. `live` (default) announces via role=alert; pass live={false} for errors present at first render (role=status). */
export function ErrorNote({ error, live = true }: { error: unknown; live?: boolean }) {
  return (
    <p role={live ? "alert" : "status"} className="rounded-xl border border-chart-4/40 bg-chart-4/10 p-3 text-sm">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
