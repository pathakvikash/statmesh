export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded border border-red-700 bg-red-50 p-3 text-red-900">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
