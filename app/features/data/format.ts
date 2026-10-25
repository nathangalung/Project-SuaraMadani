import { m } from "~/paraglide/messages.js"
import type { CategoryId } from "../../../shared/categories.ts"
import {
  type CategoryFilter,
  type Count,
  MIN_PUBLIC_N,
  type StatusFilter,
} from "../../../shared/dashboard.ts"
import { formatNumber } from "../../../shared/format.ts"
import { STAGE_TEXT } from "../issues/labels"
import { CATEGORY_SHORT_TEXT } from "../report/category-labels"

export const HIDDEN_MAX = MIN_PUBLIC_N - 1

// Dashboard only, keeps root small
const compact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 })
// Month keys are calendar labels
const monthShort = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  month: "short",
})
const monthLong = new Intl.DateTimeFormat("id-ID", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})

export function formatCompact(value: number): string {
  return compact.format(value)
}

export function formatDecimal(value: number): string {
  return decimal.format(value)
}

/** YYYY-MM to month label. */
export function formatMonth(key: string, style: "short" | "long"): string {
  const date = new Date(`${key}-01T00:00:00Z`)
  return (style === "short" ? monthShort : monthLong).format(date)
}

/** Hidden cells read 1–4. */
export function countText(count: Count | undefined): string {
  if (count === undefined) return m.data_no_data()
  if (count === null) return m.data_hidden_range({ max: HIDDEN_MAX })
  return formatNumber(count)
}

export function durationText(hours: number): string {
  // Days read better past 2
  if (hours < 48) return m.data_hours({ n: formatDecimal(hours) })
  return m.data_days({ n: formatDecimal(hours / 24) })
}

export function filterSummary(
  category: CategoryFilter,
  status: StatusFilter,
): string {
  const parts = [
    category === "all"
      ? m.data_all_categories()
      : CATEGORY_SHORT_TEXT[category as CategoryId]().toLowerCase(),
  ]
  if (status !== "all") {
    parts.push(
      m.data_status_suffix({ status: STAGE_TEXT[status]().toLowerCase() }),
    )
  }
  return parts.join(", ")
}

/** Bar length, hidden cells none. */
export function barWidth(count: Count | undefined, max: number): string {
  if (typeof count !== "number" || max <= 0) return "0%"
  return `${(count / max) * 100}%`
}
