import { describe, expect, test } from "bun:test"
import { formatIssueCode, normalizeIssueCode } from "./issue-code.ts"

describe("formatIssueCode", () => {
  test("pads the number to four digits", () => {
    expect(formatIssueCode("ITB", 2026, 42)).toBe("ISU-ITB-26-0042")
  })

  test("keeps numbers above 9999", () => {
    expect(formatIssueCode("UGM", 2031, 12345)).toBe("ISU-UGM-31-12345")
  })
})

describe("normalizeIssueCode", () => {
  test("uppercases a valid code", () => {
    expect(normalizeIssueCode("isu-itb-26-0042")).toBe("ISU-ITB-26-0042")
  })

  test.each([
    "",
    "ISU-ITB-26",
    "ISU-ITB-26-42",
    "LAP-ITB-26-0042",
    "x".repeat(80),
  ])("rejects %p", (value) => {
    expect(normalizeIssueCode(value)).toBeNull()
  })
})
