import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-14 w-full" />
      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <Skeleton className="hidden h-72 lg:block" />
        <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      </div>
    </div>
  );
}
