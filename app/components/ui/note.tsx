import { CircleAlert } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "./cn"

type Tone = "neutral" | "info" | "success" | "danger"

// Left rule, tinted fill
const tones: Record<Tone, string> = {
  neutral: "border-ink/30 bg-surface",
  info: "border-brand bg-brand-soft",
  success: "border-success bg-mint-soft",
  danger: "flex gap-3 border-danger bg-danger-soft text-danger-ink",
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
  return (
    <div
      className={cn(
        "border-l-4 p-4 text-sm leading-relaxed",
        tones[tone],
        className,
      )}
    >
      {tone === "danger" ? (
        <>
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-[1.1rem] shrink-0"
          />
          <div>{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  )
}
