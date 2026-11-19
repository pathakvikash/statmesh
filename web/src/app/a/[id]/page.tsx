import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Answer } from "@/app/chat/answer-view";
import { apiFetch } from "@/lib/client";
import type { Share } from "@/lib/chat/share";

// A share never changes, so the page is cached for a day (the API rebuilds citations on each uncached read).
export const revalidate = 86400;
export const metadata: Metadata = { title: "Shared answer", robots: { index: false, follow: false } };
type P = { params: Promise<{ id: string }> };

export default async function Page({ params }: P) {
  const { id } = await params;
  const r = await apiFetch(`/shares/${encodeURIComponent(id)}`, { cache: "force-cache", next: { revalidate: 86400 } });
  if (r.status === 404) notFound();
  if (!r.ok) throw new Error(`share lookup failed (${r.status})`); // not rendered, so an outage is never cached
  const s: Share = await r.json();
  return (
    <article className="mx-auto w-full max-w-3xl space-y-6 pb-12 pt-2">
      <p role="note" className="rounded-lg border border-border bg-muted p-3 text-sm">
        Shared by a user, recorded on {s.created_at.slice(0, 10)}. The text and numbers come from that user&apos;s session
        and may be wrong or edited; statmesh rebuilt the citations below from its catalog.
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{s.question}</h1>
      <Answer events={s.events} userText={s.question} citations={s.citations} unavailable={s.unavailable} />
    </article>
  );
}
