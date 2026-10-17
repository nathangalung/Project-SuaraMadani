import type { HTMLAttributes } from "react"
import { cn } from "./cn"

type Width = "6xl" | "5xl" | "4xl" | "3xl"

// Literal classes, no merging
const widths: Record<Width, string> = {
  "6xl": "max-w-6xl",
  "5xl": "max-w-5xl",
  "4xl": "max-w-4xl",
  "3xl": "max-w-3xl",
}

export function Container({
  width = "6xl",
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { width?: Width }) {
  return (
    <div
      className={cn("mx-auto w-full px-4 sm:px-6", widths[width], className)}
      {...rest}
    />
  )
}
