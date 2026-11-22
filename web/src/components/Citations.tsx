import { citationLine, safeHref, type Citation } from "@/lib/format";

export function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="cit" className="mt-6 rounded-xl border border-border bg-card p-4 text-sm">
      <h2 id="cit" className="mb-2 font-semibold">Citations</h2>
      <ul className="space-y-2">
        {items.map((c, i) => (
          <li key={i}>
            {citationLine(c)}. {c.source_name} / {c.dataset_id}
            {c.vintage ? `, vintage ${c.vintage}` : ""}.{" "}
            {safeHref(c.licence_url) ? <a className="text-accent hover:underline" href={safeHref(c.licence_url)}>Licence</a> : "Licence"}
            {safeHref(c.source_url) && <> · <a className="text-accent hover:underline" href={safeHref(c.source_url)}>Source page</a></>}
            {c.redistribute !== "yes" && (
              <span className="ml-1 font-medium text-foreground">Redistribution: {c.redistribute}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
