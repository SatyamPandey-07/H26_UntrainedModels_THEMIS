import { Skeleton } from "@/components/ui/card";

/** Shown while a page reads from GitHub; mirrors the dashboard's shape so nothing jumps when data lands. */
export default function Loading() {
  return (
    <div className="mx-auto grid max-w-6xl gap-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading from GitHub</span>
      <div className="grid gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-[20px]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Skeleton className="h-80 rounded-[20px]" />
        <Skeleton className="h-80 rounded-[20px]" />
      </div>
    </div>
  );
}
