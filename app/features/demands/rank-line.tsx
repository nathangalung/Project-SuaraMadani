import { cn } from "~/components/ui/cn"
import { m } from "~/paraglide/messages.js"
import type { DemandRank } from "../../../shared/demands.ts"
import { formatNumber } from "../../../shared/format.ts"

/** Null below the threshold. */
export function rankText(rank: DemandRank): string | null {
  if (rank.place === null) return null
  return m.demand_rank_line({
    place: formatNumber(rank.place),
    rankers: formatNumber(rank.rankers),
  })
}

/** Register line, place only. */
export function RankLine({
  rank,
  className,
}: {
  rank: DemandRank
  className?: string
}) {
  const text = rankText(rank)
  return text ? (
    <p className={cn("font-semibold text-xl", className)}>{text}</p>
  ) : null
}
