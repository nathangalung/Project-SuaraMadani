import { CATEGORY_TEXT } from "./category-labels.ts"
import type { LatestDemand } from "./demands.server.ts"
import { importanceText } from "./importance-line.tsx"

export type DigestDemand = LatestDemand & {
  categoryText: string | null
  importanceText: string | null
}

/** Server text keeps home small. */
export function toDigest(demand: LatestDemand): DigestDemand {
  return {
    ...demand,
    categoryText: demand.category ? CATEGORY_TEXT[demand.category]() : null,
    importanceText: importanceText(demand.importance),
  }
}
