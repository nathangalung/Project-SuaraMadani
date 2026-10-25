// Client-safe ranking rules
export type RankingErrorKey = "missing" | "duplicate"

// Field per tuntutan: rank-<code>
export const RANK_FIELD = "rank-"

/** Every tuntutan once, full order. */
export function checkRanking(
  entries: Iterable<[string, FormDataEntryValue]>,
): { ok: true; codes: string[] } | { ok: false; errors: RankingErrorKey[] } {
  const fields: { code: string; value: string }[] = []
  for (const [name, value] of entries) {
    if (!name.startsWith(RANK_FIELD) || typeof value !== "string") continue
    fields.push({ code: name.slice(RANK_FIELD.length), value })
  }
  const size = fields.length
  const chosen: { code: string; position: number }[] = []
  let missing = size === 0
  for (const { code, value } of fields) {
    const position = Number(value)
    // Positions run 1 to N
    if (
      value === "" ||
      !Number.isInteger(position) ||
      position < 1 ||
      position > size
    ) {
      missing = true
      continue
    }
    chosen.push({ code, position })
  }
  const positions = new Set(chosen.map((entry) => entry.position))
  const codes = new Set(fields.map((field) => field.code))
  const duplicate =
    positions.size !== chosen.length || codes.size !== fields.length
  const errors: RankingErrorKey[] = [
    ...(missing ? (["missing"] as const) : []),
    ...(duplicate ? (["duplicate"] as const) : []),
  ]
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    codes: chosen
      .toSorted((a, b) => a.position - b.position)
      .map((entry) => entry.code),
  }
}
