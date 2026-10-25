import { cn } from "~/components/ui/cn"
import type {
  FulfilmentStatus,
  ResponseStatus,
} from "../../../shared/status.ts"
import { FULFILMENT_TEXT, RESPONSE_TEXT } from "./labels"

const MARK =
  "inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 font-semibold text-sm"

// Text pills, no symbols
const FULFILMENT_TONE: Record<FulfilmentStatus, string> = {
  not_fulfilled: "bg-chip text-ink",
  partially_fulfilled: "bg-accent-soft text-ink",
  fulfilled: "bg-success text-on-accent",
  rejected: "bg-ink text-surface-raised",
}

export function ResponseMark({
  status,
  className,
}: {
  status: ResponseStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        MARK,
        status === "responded"
          ? "bg-success-soft text-success-ink"
          : "bg-chip text-ink",
        className,
      )}
    >
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
  return (
    <span className={cn(MARK, FULFILMENT_TONE[status], className)}>
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
      <span className="font-semibold text-sm">{label}</span>
    </span>
  )
}
