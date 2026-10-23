import { describe, expect, test } from "bun:test"
import {
  BRIEF_MAX_BYTES,
  briefTooLarge,
  citizenRanking,
  formatDemandCode,
  isDemandCategory,
  normalizeDemandCode,
  RANKING_MIN_RANKERS,
  rankingPoints,
  sharePercent,
} from "./demands.ts"

describe("demand codes", () => {
  test("format pads like issue codes", () => {
    expect(formatDemandCode("ITB", 2026, 7)).toBe("TUN-ITB-26-0007")
  })

  test("normalise accepts case, refuses others", () => {
    expect(normalizeDemandCode(" tun-itb-26-0007 ")).toBe("TUN-ITB-26-0007")
    expect(normalizeDemandCode("ISU-2026-10-0007")).toBeNull()
    expect(normalizeDemandCode("TUN-ITB-26-7")).toBeNull()
  })
})

describe("scorecard percent", () => {
  test("a nonzero count never shows 0%", () => {
    expect(sharePercent(1, 400)).toBe("<1%")
    expect(sharePercent(0, 400)).toBe("0%")
  })

  test("only all of it is 100%", () => {
    expect(sharePercent(399, 400)).toBe(">99%")
    expect(sharePercent(4, 4)).toBe("100%")
    expect(sharePercent(1, 3)).toBe("33%")
  })

  test("empty total is 0%", () => {
    expect(sharePercent(0, 0)).toBe("0%")
  })
})

describe("briefTooLarge", () => {
  test("stops a brief over 10 MB before upload", () => {
    expect(briefTooLarge(undefined)).toBe(false)
    expect(briefTooLarge({ size: BRIEF_MAX_BYTES })).toBe(false)
    expect(briefTooLarge({ size: BRIEF_MAX_BYTES + 1 })).toBe(true)
  })
})

describe("citizen ranking", () => {
  const row = (
    demandId: string,
    points: number,
    rankers: number,
    raisedOn = "2026-09-01",
  ) => ({
    demandId,
    points,
    rankers,
    raisedOn,
  })

  test("Borda: first place gets five points", () => {
    expect([1, 2, 3, 4, 5].map(rankingPoints)).toEqual([5, 4, 3, 2, 1])
  })

  test("orders by points, then rankers, then age", () => {
    const ranking = citizenRanking(
      [
        row("b", 20, 6),
        row("a", 30, 7),
        row("c", 20, 8),
        row("d", 20, 8, "2026-08-01"),
        row("z", 0, 0),
      ],
      RANKING_MIN_RANKERS,
    )
    expect(ranking.shown).toBe(true)
    expect(
      [...ranking.places.entries()].map(([id, rank]) => [id, rank.place]),
    ).toEqual([
      ["a", 1],
      ["d", 2],
      ["c", 3],
      ["b", 4],
    ])
    // No points, no place
    expect(ranking.places.has("z")).toBe(false)
  })

  test("below the threshold nothing has a place", () => {
    const ranking = citizenRanking([row("a", 30, 7)], RANKING_MIN_RANKERS - 1)
    expect(ranking.shown).toBe(false)
    expect(ranking.places.get("a")).toEqual({ place: null, rankers: 7 })
  })
})

describe("demand categories", () => {
  test("stable ids only", () => {
    expect(isDemandCategory("hukum_ham")).toBe(true)
    expect(isDemandCategory("Hukum dan HAM")).toBe(false)
    // Report taxonomy is separate
    expect(isDemandCategory("program")).toBe(false)
  })
})
