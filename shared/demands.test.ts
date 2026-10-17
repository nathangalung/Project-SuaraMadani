import { describe, expect, test } from "bun:test"
import {
  BRIEF_MAX_BYTES,
  briefTooLarge,
  formatDemandCode,
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
