import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading series">
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Skeleton className="h-96" />
        <div className="space-y-6"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      </div>
    </div>
  );
}
