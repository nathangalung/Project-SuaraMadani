import { describe, expect, test } from "bun:test"
import { formatIssueCode, normalizeIssueCode } from "./issue-code.ts"

describe("formatIssueCode", () => {
  test("year, two-digit month, four-digit number", () => {
    expect(formatIssueCode(2026, 10, 42)).toBe("ISU-2026-10-0042")
    expect(formatIssueCode(2026, 3, 1)).toBe("ISU-2026-03-0001")
  })

  test("keeps numbers above 9999", () => {
    expect(formatIssueCode(2031, 12, 12345)).toBe("ISU-2031-12-12345")
  })
})

describe("normalizeIssueCode", () => {
  test("uppercases and restores hyphens", () => {
    expect(normalizeIssueCode("isu-2026-10-0042")).toBe("ISU-2026-10-0042")
    expect(normalizeIssueCode(" isu 2026 10 0042 ")).toBe("ISU-2026-10-0042")
  })

  test.each([
    "",
    "ISU-2026-10",
    "ISU-2026-10-42",
    "ISU-2026-13-0042",
    "ISU-ITB-26-0042",
    "LPR-2026-10-0042",
    "x".repeat(80),
  ])("rejects %p", (value) => {
    expect(normalizeIssueCode(value)).toBeNull()
  })
})
