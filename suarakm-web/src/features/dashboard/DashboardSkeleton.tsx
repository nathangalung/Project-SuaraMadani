import { Skeleton } from "@/components/ui";

export function SkeletonBarisAtas() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,360px)]">
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-20 bg-white/10" />
      ))}
    </div>
  );
}
