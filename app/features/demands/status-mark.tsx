import { Ban, Check, CircleDashed, Contrast } from "lucide-react"
import { cn } from "~/components/ui/cn"
import type {
  FulfilmentStatus,
  ResponseStatus,
} from "../../../shared/status.ts"
import { FULFILMENT_TEXT, RESPONSE_TEXT } from "./labels"

const MARK = "inline-flex items-center gap-1.5 font-semibold font-ui text-sm"

// Waiting is neutral, never red
const FULFILMENT_MARK = {
  not_fulfilled: { Icon: CircleDashed, tone: "text-ink-soft" },
  partially_fulfilled: { Icon: Contrast, tone: "text-accent" },
  fulfilled: { Icon: Check, tone: "text-success-ink" },
  rejected: { Icon: Ban, tone: "text-ink" },
} as const

export function ResponseMark({
  status,
  className,
}: {
  status: ResponseStatus
  className?: string
}) {
  const Icon = status === "responded" ? Check : CircleDashed
  return (
    <span
      className={cn(
        MARK,
        status === "responded" ? "text-success-ink" : "text-ink-soft",
        className,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={3} className="size-4 shrink-0" />
      {RESPONSE_TEXT[status]()}
    </span>
  )
}

export function FulfilmentMark({
  status,
  className,
}: {
  status: FulfilmentStatus
  className?: string
}) {
  const { Icon, tone } = FULFILMENT_MARK[status]
  return (
    <span className={cn(MARK, tone, className)}>
      <Icon aria-hidden="true" strokeWidth={3} className="size-4 shrink-0" />
      {FULFILMENT_TEXT[status]()}
    </span>
  )
}

// Refused reads hollow, not done
const SEGMENT: Record<FulfilmentStatus, string> = {
  not_fulfilled: "bg-ink/15",
  partially_fulfilled: "bg-accent",
  fulfilled: "bg-success",
  rejected: "border-2 border-ink-soft",
}

/** Square per sub-tuntutan, text. */
export function ProgressSquares({
  items,
  label,
}: {
  items: readonly FulfilmentStatus[]
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="flex gap-1">
        {items.map((status, index) => (
          <span
            // Order is the item number
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed order
            key={index}
            className={cn("size-3", SEGMENT[status])}
          />
        ))}
      </span>
      <span className="font-semibold font-ui text-sm">{label}</span>
    </span>
  )
}
