export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-xl border border-chart-4/40 bg-chart-4/10 p-3 text-sm">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
