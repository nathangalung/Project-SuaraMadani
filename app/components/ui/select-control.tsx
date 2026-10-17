import { ChevronDown } from "lucide-react"
import type { SelectHTMLAttributes } from "react"
import { cn } from "./cn"
import { controlClass } from "./control"

// No Field: dashboard ships less
export function SelectControl({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          controlClass,
          "h-12 w-full cursor-pointer appearance-none pr-11 disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-line-subtle disabled:text-ink-muted",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 size-5 -translate-y-1/2 text-ink"
      />
    </div>
  )
}
