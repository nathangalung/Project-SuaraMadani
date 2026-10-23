import { CATEGORY_TEXT } from "./category-labels.ts"
import type { LatestDemand } from "./demands.server.ts"
import { rankText } from "./rank-line.tsx"

export type DigestDemand = LatestDemand & {
  categoryText: string | null
  rankText: string | null
}

/** Server text keeps home small. */
export function toDigest(demand: LatestDemand): DigestDemand {
  return {
    ...demand,
    categoryText: demand.category ? CATEGORY_TEXT[demand.category]() : null,
    rankText: rankText(demand.rank),
  }
}
