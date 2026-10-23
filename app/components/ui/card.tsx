import type { HTMLAttributes } from "react"
import { cn } from "./cn"

type Variant = "raised" | "pastel" | "inverse"

// Boxes only for objects
const variants: Record<Variant, string> = {
  raised: "border border-line-subtle bg-surface-raised",
  pastel: "bg-brand-soft",
  inverse: "bg-ink text-surface-raised",
}

export function Card({
  variant = "raised",
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: Variant }) {
  return (
    <div
      className={cn("rounded-2xl", variants[variant], className)}
      {...rest}
    />
  )
}
