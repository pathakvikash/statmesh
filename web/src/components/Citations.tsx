import { citationLine, type Citation } from "@/lib/format";

export function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="cit" className="mt-6 rounded border border-slate-300 bg-slate-50 p-4 text-sm">
      <h2 id="cit" className="mb-2 font-semibold">Citations</h2>
      <ul className="space-y-2">
        {items.map((c, i) => (
          <li key={i}>
            {citationLine(c)}. {c.source_name} / {c.dataset_id}
            {c.vintage ? `, vintage ${c.vintage}` : ""}.{" "}
            <a className="text-blue-800 underline" href={c.licence_url}>Licence</a>
            {c.source_url && <> · <a className="text-blue-800 underline" href={c.source_url}>Source page</a></>}
            {c.redistribute !== "yes" && (
              <span className="ml-1 font-medium text-amber-800">Redistribution: {c.redistribute}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
