// Client-safe ranking rules
import { RANKING_SIZE } from "../../../shared/demands.ts"

export type RankingErrorKey = "empty" | "duplicate"

// Field per tuntutan: rank-<code>
export const RANK_FIELD = "rank-"

/** Codes in chosen order. */
export function checkRanking(
  entries: Iterable<[string, FormDataEntryValue]>,
): { ok: true; codes: string[] } | { ok: false; errors: RankingErrorKey[] } {
  const chosen: { code: string; position: number }[] = []
  for (const [name, value] of entries) {
    if (!name.startsWith(RANK_FIELD) || typeof value !== "string") continue
    if (value === "") continue
    const position = Number(value)
    if (!Number.isInteger(position) || position < 1 || position > RANKING_SIZE)
      continue
    chosen.push({ code: name.slice(RANK_FIELD.length), position })
  }
  if (chosen.length === 0) return { ok: false, errors: ["empty"] }
  const positions = new Set(chosen.map((entry) => entry.position))
  if (positions.size !== chosen.length) {
    return { ok: false, errors: ["duplicate"] }
  }
  // Gaps close up
  return {
    ok: true,
    codes: chosen
      .toSorted((a, b) => a.position - b.position)
      .map((entry) => entry.code),
  }
}
