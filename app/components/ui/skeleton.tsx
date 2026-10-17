import { cn } from "./cn"

// Hydrate fallback only
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse bg-ink/8 noscript:hidden", className)}
    />
  )
}
