"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ComparePicker } from "@/components/compare/ComparePicker";
import { btn, chip } from "@/lib/ui";

/** Chips for the compared series (each removable) and the "Compare with..." button. Writes only the `compare` param. */
export function CompareBar({ selfId, title, selected }: {
  selfId: string; title: string; selected: { id: string; title: string; unit: string }[];
}) {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const write = (ids: string[]) => {
    const next = new URLSearchParams(params.toString());
    if (ids.length) next.set("compare", ids.join(","));
    else next.delete("compare");
    start(() => router.replace(`${path}?${next}`, { scroll: false }));
  };
  const ids = selected.map((s) => s.id);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      {selected.map((s) => (
        <button key={s.id} type="button" aria-label={`Remove ${s.title} from the comparison`} onClick={() => write(ids.filter((x) => x !== s.id))} className={chip}>
          <span className="max-w-xs truncate">{s.title}</span>
          {s.unit && <span className="text-xs text-muted-foreground">{s.unit}</span>}
          <span aria-hidden className="text-muted-foreground">×</span>
        </button>
      ))}
      <button type="button" onClick={() => setOpen(true)} className={btn}>Compare with…</button>
      <ComparePicker open={open} onOpenChange={setOpen} selfId={selfId} title={title} selected={ids}
        onPick={(id) => { setOpen(false); write([...ids, id]); }} />
    </div>
  );
}
