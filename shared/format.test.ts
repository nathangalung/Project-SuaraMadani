import { describe, expect, test } from "bun:test"
import {
  daysSince,
  formatDate,
  formatDateTime,
  formatDuration,
  formatFileSize,
  formatIsoDate,
  formatNumber,
  formatPercent,
  formatRange,
  jakartaIsoDate,
  jakartaYear,
  latestIsoDate,
} from "./format.ts"

const morning = new Date("2026-10-13T02:30:00Z")
const lateUtc = new Date("2026-12-31T17:30:00Z")

describe("dates", () => {
  test("long date in Indonesian", () => {
    expect(formatDate(morning)).toBe("13 Oktober 2026")
  })

  test("date and time in WIB", () => {
    expect(formatDateTime(morning)).toBe("13 Oktober 2026 pukul 09.30")
  })

  test("UTC evening is next day in Jakarta", () => {
    expect(formatDate(lateUtc)).toBe("1 Januari 2027")
    expect(jakartaIsoDate(lateUtc)).toBe("2027-01-01")
    expect(jakartaYear(lateUtc)).toBe(2027)
  })

  test("latest Indonesian day is the WIT day", () => {
    // 00:30 WIT, still 22:30 WIB
    const witMidnight = new Date("2026-10-13T15:30:00Z")
    expect(jakartaIsoDate(witMidnight)).toBe("2026-10-13")
    expect(latestIsoDate(witMidnight)).toBe("2026-10-14")
    expect(latestIsoDate(morning)).toBe("2026-10-13")
  })

  test("ISO date pads month and day", () => {
    expect(jakartaIsoDate(new Date("2026-03-04T01:00:00Z"))).toBe("2026-03-04")
  })
})

describe("numbers", () => {
  test("dot thousands, comma decimals", () => {
    expect(formatNumber(12481)).toBe("12.481")
    expect(formatNumber(2.7)).toBe("2,7")
  })

  test("percent with one decimal", () => {
    expect(formatPercent(0.273)).toBe("27,3%")
    expect(formatPercent(1)).toBe("100%")
  })
})

describe("daysSince", () => {
  test("counts Jakarta calendar days", () => {
    const sent = new Date("2026-10-01T16:59:00Z")
    const now = new Date("2026-10-13T02:30:00Z")
    expect(daysSince(sent, now)).toBe(12)
  })

  test("same Jakarta day is zero", () => {
    const a = new Date("2026-10-13T00:00:00Z")
    expect(daysSince(a, morning)).toBe(0)
  })

  test("crossing WIB midnight counts one day", () => {
    const before = new Date("2026-10-12T16:59:00Z")
    const after = new Date("2026-10-12T17:01:00Z")
    expect(daysSince(before, after)).toBe(1)
  })

  test("future start clamps to zero", () => {
    expect(daysSince(lateUtc, morning)).toBe(0)
  })
})

describe("formatIsoDate", () => {
  test("a calendar day keeps its day", () => {
    expect(formatIsoDate("2026-10-01")).toBe("1 Oktober 2026")
    expect(formatIsoDate("2026-12-31")).toBe("31 Desember 2026")
  })
})

describe("formatDuration", () => {
  test("minutes and zero-padded seconds", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(42_400)).toBe("0:42")
    expect(formatDuration(179_600)).toBe("3:00")
    expect(formatDuration(65_000)).toBe("1:05")
  })
})

describe("formatFileSize", () => {
  test("KB under a megabyte, MB with one decimal", () => {
    expect(formatFileSize(10)).toBe("1 KB")
    expect(formatFileSize(2048)).toBe("2 KB")
    expect(formatFileSize(1024 * 1024)).toBe("1 MB")
    expect(formatFileSize(10.5 * 1024 * 1024)).toBe("10,5 MB")
  })
})

describe("formatRange", () => {
  test("limits read with id-ID grouping", () => {
    expect(formatRange({ min: 20, max: 2000 })).toEqual({
      min: "20",
      max: "2.000",
    })
  })
})
