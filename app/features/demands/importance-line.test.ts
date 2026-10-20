import { describe, expect, test } from "bun:test"
import { formatImportance, importanceText } from "./importance-line"

describe("importance text", () => {
  test("Indonesian comma, one decimal", () => {
    expect(formatImportance(3.8)).toBe("3,8")
    expect(formatImportance(5)).toBe("5,0")
  })

  test("no line below the threshold", () => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 9 }
    expect(importanceText({ raters: 9, counts, mean: null })).toBeNull()
    expect(
      importanceText({ raters: 1200, counts: { ...counts, 5: 1200 }, mean: 5 }),
    ).toBe("Kepentingan menurut warga 5,0 dari 5 · 1.200 penilai")
  })
})
