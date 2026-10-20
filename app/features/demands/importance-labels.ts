import { m } from "~/paraglide/messages.js"
import type { ImportanceScore } from "../../../shared/demands.ts"

// Own module, keeps home small
export const IMPORTANCE_TEXT: Record<ImportanceScore, () => string> = {
  1: m.importance_score_1,
  2: m.importance_score_2,
  3: m.importance_score_3,
  4: m.importance_score_4,
  5: m.importance_score_5,
}
