import { describe, expect, test } from "bun:test"
import {
  completedSteps,
  validateContact,
  validateDetails,
  validateEvidence,
  validateImpact,
  validateLocation,
  validateRelation,
} from "./validate"

const TODAY = "2026-10-13"

describe("validateRelation", () => {
  test("needs a relation", () => {
    expect(validateRelation({})).toEqual([
      { field: "relation", key: "error_relation_required" },
    ])
  })

  test("on behalf needs the other person's consent", () => {
    expect(validateRelation({ relation: "on_behalf" })).toEqual([
      { field: "otherConsent", key: "error_other_consent_required" },
    ])
    expect(
      validateRelation({ relation: "on_behalf", otherConsent: "not_asked" }),
    ).toEqual([])
    expect(validateRelation({ relation: "witness" })).toEqual([])
  })
})

describe("validateLocation", () => {
  test("asks only for the first missing level", () => {
    expect(validateLocation({})).toEqual([
      { field: "provinceCode", key: "error_province_required" },
    ])
    expect(validateLocation({ provinceCode: "32" })).toEqual([
      { field: "regencyCode", key: "error_regency_required" },
    ])
    expect(
      validateLocation({ provinceCode: "32", regencyCode: "32.73" }),
    ).toEqual([{ field: "districtCode", key: "error_district_required" }])
  })

  test("village is optional", () => {
    expect(
      validateLocation({
        provinceCode: "32",
        regencyCode: "32.73",
        districtCode: "32.73.02",
      }),
    ).toEqual([])
  })
})

describe("validateDetails", () => {
  const valid = {
    title: "Atap sekolah runtuh",
    story:
      "Atap ruang kelas runtuh minggu lalu dan siswa belajar di halaman sekolah.",
    categoryId: "program",
    subcategoryId: "program.pendidikan",
    occurredOn: "2026-10-01",
    urgency: "medium",
  }

  test("accepts a complete answer", () => {
    expect(validateDetails(valid, TODAY)).toEqual([])
  })

  test("names how to fix each field", () => {
    expect(
      validateDetails(
        {
          ...valid,
          title: "Atap",
          story: "",
          subcategoryId: "bansos.program_bansos",
          occurredOn: "2026-10-14",
          urgency: undefined,
        },
        TODAY,
      ),
    ).toEqual([
      { field: "title", key: "error_title_too_short" },
      { field: "story", key: "error_story_required" },
      { field: "subcategoryId", key: "error_subcategory_mismatch" },
      { field: "occurredOn", key: "error_occurred_on_future" },
      { field: "urgency", key: "error_urgency_required" },
    ])
  })

  test("an impossible date is invalid", () => {
    expect(validateDetails({ ...valid, occurredOn: undefined }, TODAY)).toEqual(
      [{ field: "occurredOn", key: "error_occurred_on_invalid" }],
    )
  })

  test("a year before the minimum is refused", () => {
    expect(
      validateDetails({ ...valid, occurredOn: "1000-01-01" }, TODAY),
    ).toEqual([{ field: "occurredOn", key: "error_occurred_on_too_old" }])
  })

  test("long agency names are refused", () => {
    expect(
      validateDetails({ ...valid, agency: "x".repeat(201) }, TODAY),
    ).toEqual([{ field: "agency", key: "error_agency_too_long" }])
  })
})

describe("validateImpact", () => {
  test("needs every answer", () => {
    expect(validateImpact({ groups: [] }).map((e) => e.key)).toEqual([
      "error_groups_required",
      "error_affected_count_required",
      "error_ongoing_required",
    ])
    expect(
      validateImpact({
        groups: ["students"],
        affectedCount: "unknown",
        ongoing: "no",
      }),
    ).toEqual([])
  })
})

describe("validateEvidence", () => {
  const png = { name: "a.png", size: 1000, type: "image/png" }

  test("accepts up to five small images", () => {
    expect(validateEvidence([png, png])).toEqual([])
  })

  test("accepts PDF, HEIC and video", () => {
    expect(
      validateEvidence([
        { name: "a.pdf", size: 10, type: "application/pdf" },
        { name: "IMG_1.HEIC", size: 10, type: "" },
        { name: "b.heic", size: 10, type: "image/heic" },
        { name: "c.mov", size: 40 * 1024 * 1024, type: "video/quicktime" },
      ]),
    ).toEqual([])
  })

  test("video limits from browser metadata", () => {
    const video = { name: "v.mp4", size: 1000, type: "video/mp4" }
    expect(validateEvidence([{ ...video, durationSeconds: 181 }])).toEqual([
      { field: "evidence", key: "error_video_too_long" },
    ])
    expect(validateEvidence([{ ...video, width: 3840, height: 2160 }])).toEqual(
      [{ field: "evidence", key: "error_video_resolution" }],
    )
    expect(
      validateEvidence([{ ...video, size: 50 * 1024 * 1024 + 1 }]),
    ).toEqual([{ field: "evidence", key: "error_evidence_too_large" }])
  })

  test("refuses other types, large files and a sixth file", () => {
    expect(
      validateEvidence([
        { name: "a.exe", size: 10, type: "application/x-msdownload" },
      ]),
    ).toEqual([{ field: "evidence", key: "error_evidence_type" }])
    expect(
      validateEvidence([{ name: "a.svg", size: 10, type: "image/svg+xml" }]),
    ).toEqual([{ field: "evidence", key: "error_evidence_type" }])
    expect(validateEvidence([{ ...png, size: 10 * 1024 * 1024 + 1 }])).toEqual([
      { field: "evidence", key: "error_evidence_too_large" },
    ])
    expect(validateEvidence(Array(6).fill(png))).toEqual([
      { field: "evidence", key: "error_evidence_too_many" },
    ])
  })
})

describe("validateContact", () => {
  test("no needs nothing else", () => {
    expect(validateContact({ contactable: "no" })).toEqual([])
    expect(validateContact({})).toEqual([
      { field: "contactable", key: "error_contactable_required" },
    ])
  })

  test("yes needs a method, the number comes from the account", () => {
    expect(validateContact({ contactable: "yes" })).toEqual([
      { field: "method", key: "error_contact_method_required" },
    ])
    expect(validateContact({ contactable: "yes", method: "whatsapp" })).toEqual(
      [],
    )
  })
})

describe("completedSteps", () => {
  const ID = "6f1c2b9e-0d4a-4c3b-9a8e-2f5d7c1b3a90"
  const none = { files: [] }

  test("only answered steps without problems", () => {
    const done = completedSteps(
      {
        submissionId: ID,
        relation: { relation: "self" },
        location: { provinceCode: "32" },
        contact: { contactable: "no" },
      },
      TODAY,
      none,
    )
    expect([...done]).toEqual(["relation", "contact"])
  })

  test("skipped evidence is done once visited", () => {
    expect(completedSteps({ submissionId: ID }, TODAY, none).size).toBe(0)
    const visited = completedSteps(
      { submissionId: ID, evidence: [] },
      TODAY,
      none,
    )
    expect([...visited]).toEqual(["evidence"])
  })

  test("contact survives a reload, no number held", () => {
    const draft = {
      submissionId: ID,
      contact: { contactable: "yes", method: "whatsapp" },
    }
    expect(completedSteps(draft, TODAY, none).has("contact")).toBe(true)
  })

  test("photos lost on reload reopen evidence", () => {
    const photo = { name: "atap.jpg", size: 10, type: "image/jpeg" }
    const draft = { submissionId: ID, evidence: [photo] }
    expect(completedSteps(draft, TODAY, none).has("evidence")).toBe(false)
    const held = { files: [photo] }
    expect(completedSteps(draft, TODAY, held).has("evidence")).toBe(true)
  })
})
