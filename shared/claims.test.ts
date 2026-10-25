import { describe, expect, test } from "bun:test"
import {
  CLAIM_RULES,
  claimDistribution,
  isRatingScore,
  isSurveyAnswer,
  ratingAnomaly,
  surveyDecision,
  surveySupportsConfirm,
} from "./claims.ts"

describe("survey rule", () => {
  test("one not fixed answer reopens at once", () => {
    expect(surveyDecision({ invited: 3, fixed: 2, notFixed: 1 })).toBe("reopen")
    expect(surveyDecision({ invited: 3, fixed: 0, notFixed: 1 })).toBe("reopen")
  })

  test("every reporter fixed confirms", () => {
    expect(surveyDecision({ invited: 1, fixed: 1, notFixed: 0 })).toBe(
      "confirm",
    )
    expect(surveyDecision({ invited: 3, fixed: 3, notFixed: 0 })).toBe(
      "confirm",
    )
  })

  test("missing answers wait for the admin", () => {
    expect(surveyDecision({ invited: 3, fixed: 2, notFixed: 0 })).toBe("wait")
    expect(surveyDecision({ invited: 0, fixed: 0, notFixed: 0 })).toBe("wait")
  })

  test("an admin may confirm on partial fixed answers", () => {
    expect(surveySupportsConfirm({ fixed: 1, notFixed: 0 })).toBe(true)
    expect(surveySupportsConfirm({ fixed: 0, notFixed: 0 })).toBe(false)
    expect(surveySupportsConfirm({ fixed: 4, notFixed: 1 })).toBe(false)
  })

  test("answers and scores are closed lists", () => {
    expect(isSurveyAnswer("fixed")).toBe(true)
    expect(isSurveyAnswer("not_fixed")).toBe(true)
    expect(isSurveyAnswer("maybe")).toBe(false)
    expect(isRatingScore(1)).toBe(true)
    expect(isRatingScore(5)).toBe(true)
    expect(isRatingScore(0)).toBe(false)
    expect(isRatingScore(2.5)).toBe(false)
  })
})

describe("rating distribution", () => {
  test("hidden below the minimum n", () => {
    const rows = [{ score: 4, n: CLAIM_RULES.minShown - 1 }]
    expect(claimDistribution(rows)).toEqual({
      n: CLAIM_RULES.minShown - 1,
      counts: null,
    })
  })

  test("counts per score from the minimum n", () => {
    const rows = [
      { score: 1, n: 2 },
      { score: 5, n: 7 },
      { score: 3, n: 1 },
      // Out of range ignored
      { score: 9, n: 4 },
    ]
    expect(claimDistribution(rows)).toEqual({
      n: 10,
      counts: { 1: 2, 2: 0, 3: 1, 4: 0, 5: 7 },
    })
  })
})

describe("rating anomaly", () => {
  test("no flag below the minimum n", () => {
    expect(ratingAnomaly({ total: 9, topPrefix: 9, young: 9 })).toEqual({
      prefix: false,
      young: false,
    })
  })

  test("over 30 percent from one prefix", () => {
    expect(ratingAnomaly({ total: 10, topPrefix: 3, young: 0 }).prefix).toBe(
      false,
    )
    expect(ratingAnomaly({ total: 10, topPrefix: 4, young: 0 }).prefix).toBe(
      true,
    )
  })

  test("over 30 percent from young accounts", () => {
    expect(ratingAnomaly({ total: 20, topPrefix: 1, young: 6 }).young).toBe(
      false,
    )
    expect(ratingAnomaly({ total: 20, topPrefix: 1, young: 7 }).young).toBe(
      true,
    )
  })

  test("starting values match architecture", () => {
    expect(CLAIM_RULES).toEqual({
      surveyDelayDays: 28,
      minShown: 10,
      accountDays: 7,
      prefixCap: 20,
      anomalyShare: 0.3,
      youngDays: 30,
      clientKeepDays: 30,
    })
  })
})
