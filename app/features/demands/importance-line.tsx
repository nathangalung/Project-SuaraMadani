import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import type { Importance } from "../../../shared/demands.ts"
import { formatNumber } from "../../../shared/format.ts"

/** "4,3", one decimal always. */
export function formatImportance(mean: number): string {
  return mean.toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

/** Null below the threshold. */
export function importanceText(importance: Importance): string | null {
  if (importance.mean === null) return null
  return m.demand_importance_line({
    mean: formatImportance(importance.mean),
    raters: formatNumber(importance.raters),
  })
}

/** Register line, mean only. */
export function ImportanceLine({
  importance,
  className,
}: {
  importance: Importance
  className?: string
}) {
  const text = importanceText(importance)
  return text ? (
    <p className={cn("font-semibold font-ui text-sm", className)}>{text}</p>
  ) : null
}
