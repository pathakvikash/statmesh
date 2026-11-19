import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading series" className="space-y-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-16 w-48" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
