import type { ReactNode } from "react"
import { cn } from "../ui/cn"
import { useReveal } from "./use-reveal"

type SectionHeadingProps = {
  title: string
  id?: string
  description?: ReactNode
  action?: ReactNode
  align?: "start" | "center"
  // White text on ink bands
  inverse?: boolean
  className?: string
}

export function SectionHeading({
  title,
  id,
  description,
  action,
  align = "start",
  inverse = false,
  className,
}: SectionHeadingProps) {
  const ref = useReveal<HTMLDivElement>()
  const center = align === "center"
  return (
    <div
      ref={ref}
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-5",
        center
          ? "items-center text-center"
          : "sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className={cn("max-w-2xl", center && "mx-auto")}>
        <h2
          id={id}
          className={cn(
            "font-bold font-heading text-[clamp(2rem,4.4vw,3rem)] leading-[1.1] [font-synthesis-weight:none]",
            inverse ? "text-surface-raised" : "text-ink",
          )}
        >
          {title}
        </h2>
        {description && (
          <p
            className={cn(
              "mt-3 text-lg leading-relaxed",
              inverse ? "text-surface-raised/80" : "text-ink-soft",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
