import type { ReactNode } from "react"
import { cn } from "./cn"

export type BadgeTone =
  | "neutral"
  | "subtle"
  | "soft"
  | "brand"
  | "ink"
  | "success"
  | "danger"

// Green and red carry meaning
const tones: Record<BadgeTone, string> = {
  neutral: "bg-chip text-ink",
  subtle: "bg-ink/8 text-ink",
  soft: "bg-accent-soft text-accent",
  brand: "bg-brand text-on-accent",
  ink: "bg-ink text-surface-raised",
  success: "bg-success text-on-accent",
  danger: "bg-danger text-on-accent",
}

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        // One line, never splits
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 font-semibold text-sm leading-tight",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
