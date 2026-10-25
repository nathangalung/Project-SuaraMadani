import { describe, expect, test } from "bun:test"
import {
  CATEGORY_FILTERS,
  DEMAND_MAP_CLASSES,
  filterKey,
  MIN_PUBLIC_N,
  mapClass,
  publicCount,
  publicShare,
  STATUS_FILTERS,
  trendMonths,
} from "./dashboard.ts"

describe("small-n suppression", () => {
  test("hides 1 to 4, keeps 0 and 5 up", () => {
    expect(MIN_PUBLIC_N).toBe(5)
    expect(publicCount(0)).toBe(0)
    for (const n of [1, 2, 3, 4]) expect(publicCount(n)).toBeNull()
    expect(publicCount(5)).toBe(5)
    expect(publicCount(120)).toBe(120)
  })

  test("a share needs a denominator of 5", () => {
    expect(publicShare(2, 4)).toBeNull()
    expect(publicShare(0, 0)).toBeNull()
    expect(publicShare(2, 5)).toBe(0.4)
  })
})

describe("map classes", () => {
  test("fixed classes shared by every view", () => {
    expect(mapClass(undefined)).toBe("none")
    expect(mapClass(0)).toBe("zero")
    expect(mapClass(null)).toBe("few")
    // Exact small counts share it
    expect(mapClass(3)).toBe("few")
    expect(mapClass(5)).toBe("low")
    expect(mapClass(19)).toBe("low")
    expect(mapClass(20)).toBe("mid")
    expect(mapClass(49)).toBe("mid")
    expect(mapClass(50)).toBe("high")
    expect(mapClass(5000)).toBe("high")
  })

  test("tuntutan layer has its own fixed classes", () => {
    const classOf = (n: number) => mapClass(n, DEMAND_MAP_CLASSES)
    expect(classOf(0)).toBe("zero")
    expect(classOf(1)).toBe("few")
    expect(classOf(2)).toBe("low")
    expect(classOf(3)).toBe("mid")
    expect(classOf(4)).toBe("mid")
    expect(classOf(5)).toBe("high")
    expect(classOf(40)).toBe("high")
    // Same ids, no hidden class
    expect(DEMAND_MAP_CLASSES.map((step) => step.id)).toEqual([
      "zero",
      "few",
      "low",
      "mid",
      "high",
    ])
  })

  test("one key per filter pair", () => {
    const keys = CATEGORY_FILTERS.flatMap((c) =>
      STATUS_FILTERS.map((s) => filterKey(c, s)),
    )
    expect(new Set(keys).size).toBe(4 * 6)
    expect(filterKey("all", "all")).toBe("all|all")
  })
})

describe("trend months", () => {
  test("twelve Jakarta months, oldest first", () => {
    // 1 Jan 2027 in Jakarta
    const months = trendMonths(new Date("2026-12-31T17:30:00Z"))
    expect(months).toHaveLength(12)
    expect(months[0]).toBe("2026-02")
    expect(months[11]).toBe("2027-01")
  })
})
