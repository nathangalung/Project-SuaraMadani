// Resolution claims, PLAN §5.7

export const CLAIM_OUTCOMES = ["confirmed", "reopened"] as const
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number]

// Who closed the claim
export const CLAIM_BASES = ["survey", "admin"] as const
export type ClaimBasis = (typeof CLAIM_BASES)[number]

export const SURVEY_ANSWERS = ["fixed", "not_fixed"] as const
export type SurveyAnswer = (typeof SURVEY_ANSWERS)[number]

const RATING_SCORES = [1, 2, 3, 4, 5] as const
export type RatingScore = (typeof RATING_SCORES)[number]

// Starting Values: rating eligibility
export const CLAIM_RULES = {
  surveyDelayDays: 28,
  minShown: 10,
  accountDays: 7,
  prefixCap: 20,
  anomalyShare: 0.3,
  youngDays: 30,
  clientKeepDays: 30,
} as const

export function isSurveyAnswer(value: string): value is SurveyAnswer {
  return (SURVEY_ANSWERS as readonly string[]).includes(value)
}

export function isRatingScore(value: number): value is RatingScore {
  return (RATING_SCORES as readonly number[]).includes(value)
}

export type SurveyTally = { invited: number; fixed: number; notFixed: number }

/** One no reopens, all confirm. */
export function surveyDecision(
  tally: SurveyTally,
): "reopen" | "confirm" | "wait" {
  if (tally.notFixed > 0) return "reopen"
  if (tally.invited > 0 && tally.fixed === tally.invited) return "confirm"
  return "wait"
}

/** Basis for an admin confirm. */
export function surveySupportsConfirm(
  tally: Pick<SurveyTally, "fixed" | "notFixed">,
): boolean {
  return tally.fixed > 0 && tally.notFixed === 0
}

export type ClaimDistribution = {
  n: number
  // Null below CLAIM_RULES.minShown
  counts: Record<RatingScore, number> | null
}

/** 1-5 counts, never a mean. */
export function claimDistribution(
  rows: readonly { score: number; n: number }[],
): ClaimDistribution {
  const counts: Record<RatingScore, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let n = 0
  for (const row of rows) {
    if (!isRatingScore(row.score) || row.n <= 0) continue
    counts[row.score] += row.n
    n += row.n
  }
  return { n, counts: n >= CLAIM_RULES.minShown ? counts : null }
}

export type AnomalyInput = { total: number; topPrefix: number; young: number }

/** Admin flag, from minShown ratings. */
export function ratingAnomaly(input: AnomalyInput): {
  prefix: boolean
  young: boolean
} {
  if (input.total < CLAIM_RULES.minShown) return { prefix: false, young: false }
  const limit = input.total * CLAIM_RULES.anomalyShare
  return { prefix: input.topPrefix > limit, young: input.young > limit }
}
