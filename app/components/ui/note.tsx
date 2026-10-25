import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "./cn"

type Tone = "neutral" | "info" | "success" | "danger"

// Icon carries tone, no box
const tones: Record<Tone, string> = {
  neutral: "text-ink-soft",
  info: "flex gap-3 text-ink",
  success: "flex gap-3 text-ink",
  danger: "flex gap-3 text-danger",
}

const icons: Partial<Record<Tone, { Icon: LucideIcon; className: string }>> = {
  info: { Icon: Info, className: "text-accent" },
  success: { Icon: CircleCheck, className: "text-success" },
  danger: { Icon: CircleAlert, className: "" },
}

export function Note({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: ReactNode
}) {
  const icon = icons[tone]
  return (
    <div className={cn("text-sm leading-relaxed", tones[tone], className)}>
      {icon ? (
        <>
          <icon.Icon
            aria-hidden="true"
            className={cn("mt-0.5 size-[1.1rem] shrink-0", icon.className)}
          />
          <div>{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  )
}
