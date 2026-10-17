import { describe, expect, test } from "bun:test"
import {
  APPEAL_WINDOW_DAYS,
  appealOpen,
  COMPLAINT_DECISIONS,
  COMPLAINT_PARTS,
  COMPLAINT_REASONS,
  COMPLAINT_STATUSES,
  complaintStage,
  decisionReasons,
  generateComplaintCode,
  isDecisionReasonFor,
  normalizeComplaintCode,
  visibilityAction,
} from "./complaints.ts"

const AT = (iso: string) => new Date(iso)

describe("complaint codes", () => {
  test("codes fit CHECK literals", () => {
    for (const code of [
      ...COMPLAINT_REASONS,
      ...COMPLAINT_PARTS,
      ...COMPLAINT_STATUSES,
      ...COMPLAINT_DECISIONS,
      ...decisionReasons("keep"),
      ...decisionReasons("remove"),
    ]) {
      expect(code).toMatch(/^[a-z0-9_.]+$/)
    }
  })

  test("receipt code names the campus and year", () => {
    const code = generateComplaintCode("ITB", AT("2026-12-31T18:00:00Z"), (t) =>
      t.fill(0),
    )
    expect(code).toBe("ADU-ITB-27-00000")
  })

  test("receipt codes normalise like report codes", () => {
    expect(normalizeComplaintCode("adu-itb-26-x3k9o")).toBe("ADU-ITB-26-X3K90")
    expect(normalizeComplaintCode("ITB-26-X3K9P")).toBeNull()
    expect(normalizeComplaintCode("ADU-")).toBeNull()
  })
})

describe("decision rules", () => {
  test("keep cites no standard, actions cite one", () => {
    expect(isDecisionReasonFor("keep", "no_violation")).toBe(true)
    expect(isDecisionReasonFor("keep", "standard_3")).toBe(false)
    expect(isDecisionReasonFor("edit", "standard_11")).toBe(true)
    expect(isDecisionReasonFor("remove", "no_violation")).toBe(false)
    expect(isDecisionReasonFor("hide", "out_of_scope")).toBe(false)
  })

  test("each action maps to one visibility change", () => {
    expect(visibilityAction("keep")).toBeNull()
    expect(visibilityAction("edit")).toBe("redact")
    expect(visibilityAction("hide")).toBe("unpublish")
    expect(visibilityAction("remove")).toBe("take_down")
  })

  test("open and appealed complaints take a decision", () => {
    expect(complaintStage("open")).toBe("first")
    expect(complaintStage("appealed")).toBe("appeal")
    expect(complaintStage("decided")).toBeNull()
    expect(complaintStage("appeal_decided")).toBeNull()
  })
})

describe("appeal window", () => {
  const decidedAt = AT("2026-01-01T00:00:00Z")

  test("one appeal while the window is open", () => {
    expect(APPEAL_WINDOW_DAYS).toBeGreaterThanOrEqual(180)
    const inside = AT("2026-06-29T23:59:00Z")
    expect(appealOpen({ status: "decided", decidedAt }, inside)).toBe(true)
    expect(appealOpen({ status: "appealed", decidedAt }, inside)).toBe(false)
    expect(appealOpen({ status: "open", decidedAt: null }, inside)).toBe(false)
  })

  test("closes after the window", () => {
    const late = AT("2026-07-01T00:00:01Z")
    expect(appealOpen({ status: "decided", decidedAt }, late)).toBe(false)
  })
})
