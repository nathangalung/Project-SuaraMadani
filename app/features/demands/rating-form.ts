// Client-safe importance form rules
import {
  type ImportanceScore,
  isImportanceScore,
} from "../../../shared/demands.ts"

export type RatingErrorKey = "score" | "visibility"

export type RatingInput = { score: ImportanceScore; showName: boolean }

/** Score 1-5, named or anonymous. */
export function checkRating(fields: {
  score: string
  visibility: string
}): { ok: true; input: RatingInput } | { ok: false; errors: RatingErrorKey[] } {
  const score = /^[1-5]$/.test(fields.score) ? Number(fields.score) : 0
  const named = fields.visibility === "named"
  const errors: RatingErrorKey[] = []
  if (!isImportanceScore(score)) errors.push("score")
  if (!named && fields.visibility !== "anonymous") errors.push("visibility")
  if (errors.length > 0 || !isImportanceScore(score)) {
    return { ok: false, errors }
  }
  return { ok: true, input: { score, showName: named } }
}
