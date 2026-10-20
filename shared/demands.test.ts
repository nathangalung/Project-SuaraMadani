import { describe, expect, test } from "bun:test"
import {
  BRIEF_MAX_BYTES,
  briefTooLarge,
  formatDemandCode,
  IMPORTANCE_MIN_RATERS,
  importanceOf,
  isDemandCategory,
  normalizeDemandCode,
  sharePercent,
} from "./demands.ts"

describe("demand codes", () => {
  test("format pads like issue codes", () => {
    expect(formatDemandCode("ITB", 2026, 7)).toBe("TUN-ITB-26-0007")
  })

  test("normalise accepts case, refuses others", () => {
    expect(normalizeDemandCode(" tun-itb-26-0007 ")).toBe("TUN-ITB-26-0007")
    expect(normalizeDemandCode("ISU-ITB-26-0007")).toBeNull()
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

describe("importance summary", () => {
  test("no mean until enough raters", () => {
    const few = importanceOf([{ score: 5, n: IMPORTANCE_MIN_RATERS - 1 }])
    expect(few.raters).toBe(IMPORTANCE_MIN_RATERS - 1)
    expect(few.mean).toBeNull()
  })

  test("mean rounds to one decimal, as shown", () => {
    const summary = importanceOf([
      { score: 5, n: 7 },
      { score: 4, n: 2 },
      { score: 1, n: 3 },
    ])
    expect(summary.counts).toEqual({ 1: 3, 2: 0, 3: 0, 4: 2, 5: 7 })
    expect(summary.raters).toBe(12)
    // 46 / 12 = 3.83
    expect(summary.mean).toBe(3.8)
  })

  test("rows outside the scale are ignored", () => {
    const summary = importanceOf([
      { score: 0, n: 4 },
      { score: 6, n: 4 },
      { score: 3, n: 0 },
    ])
    expect(summary.raters).toBe(0)
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
