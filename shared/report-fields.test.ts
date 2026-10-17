import { describe, expect, test } from "bun:test"
import {
  CONSENT_KEYS,
  EVIDENCE_LIMITS,
  evidenceKind,
  REPORT_ERROR_KEYS,
  REPORT_STEPS,
} from "./report-fields.ts"

const MB = 1024 * 1024

describe("report fields", () => {
  test("steps are ordered for Ubah links", () => {
    expect(REPORT_STEPS).toEqual([
      "relation",
      "location",
      "details",
      "impact",
      "evidence",
      "contact",
      "consent",
    ])
  })

  test("error keys are unique message identifiers", () => {
    expect(new Set(REPORT_ERROR_KEYS).size).toBe(REPORT_ERROR_KEYS.length)
    for (const key of REPORT_ERROR_KEYS) expect(key).toMatch(/^error_[a-z_]+$/)
  })

  test("age box is the first consent key", () => {
    expect(CONSENT_KEYS[0]).toBe("age_18_plus")
  })

  test("limits per kind, PLAN §7", () => {
    expect(EVIDENCE_LIMITS).toEqual({
      image: 10 * MB,
      pdf: 10 * MB,
      video: 50 * MB,
    })
  })

  test("kind from type, HEIC by extension", () => {
    expect(evidenceKind({ type: "image/heic", name: "a.heic" })).toBe("image")
    expect(evidenceKind({ type: "IMAGE/JPEG", name: "a.jpg" })).toBe("image")
    expect(evidenceKind({ type: "", name: "IMG_0001.HEIC" })).toBe("image")
    expect(evidenceKind({ type: "application/pdf", name: "a.pdf" })).toBe("pdf")
    expect(evidenceKind({ type: "video/quicktime", name: "a.mov" })).toBe(
      "video",
    )
    expect(evidenceKind({ type: "application/zip", name: "a.zip" })).toBe(
      undefined,
    )
    expect(evidenceKind({ type: "", name: "noextension" })).toBe(undefined)
  })
})
