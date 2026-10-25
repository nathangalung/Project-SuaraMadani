import { describe, expect, test } from "bun:test"
import {
  AGE_CONSENT_VERSION,
  CONSENT_TEXT_VERSION,
  OCCURRED_ON_MIN_YEAR,
  REPORT_ERROR_KEYS,
} from "./report-fields.ts"
import {
  ageDeclarationSchema,
  consentStep,
  contactStep,
  createDetailsStep,
  createReportSchema,
  evidenceStep,
  impactStep,
  locationStep,
  relationStep,
} from "./report-schema.ts"

const today = "2026-10-13"
const MB = 1024 * 1024

const consent = {
  consents: {
    age_18_plus: true,
    accurate: true,
    public_issue: true,
    aggregate_processing: true,
  },
  consentTextVersion: CONSENT_TEXT_VERSION,
}

const validReport = {
  submissionId: "0199d4a2-8f3b-4c1e-9a7d-2b5e6f708192",
  relation: { relation: "self" },
  location: {
    provinceCode: "32",
    regencyCode: "32.73",
    districtCode: "32.73.01",
    villageCode: "32.73.01.1001",
  },
  details: {
    title: "Jalan berlubang di depan sekolah",
    story:
      "Lubang besar di jalan depan sekolah sudah tiga bulan tidak diperbaiki.",
    categoryId: "program",
    subcategoryId: "program.infrastruktur",
    occurredOn: "2026-10-01",
    urgency: "medium",
  },
  impact: {
    groups: ["children", "general_public"],
    affectedCount: "101_1000",
    ongoing: "yes",
  },
  evidence: [{ name: "foto.jpg", size: 2 * MB, type: "image/jpeg" }],
  contact: { contactable: "no" },
  consent,
}

const keys = new Set<string>(REPORT_ERROR_KEYS)

function messages(result: {
  success: boolean
  error?: { issues: { message: string }[] }
}): string[] {
  return result.error?.issues.map((i) => i.message) ?? []
}

describe("full report", () => {
  const schema = createReportSchema(today)

  test("accepts a complete report", () => {
    const result = schema.safeParse(validReport)
    expect(result.success).toBe(true)
  })

  test("issue path starts with the step key", () => {
    const result = schema.safeParse({
      ...validReport,
      details: { ...validReport.details, title: "" },
    })
    expect(result.error?.issues[0]?.path).toEqual(["details", "title"])
  })

  test("rejects a missing age box", () => {
    const result = schema.safeParse({
      ...validReport,
      consent: {
        ...consent,
        consents: { ...consent.consents, age_18_plus: false },
      },
    })
    expect(result.success).toBe(false)
    expect(messages(result)).toContain("error_consent_age_required")
  })

  test("submission id must be a UUID", () => {
    const result = schema.safeParse({ ...validReport, submissionId: "abc" })
    expect(messages(result)).toEqual(["error_submission_id"])
  })

  test("every emitted message is a known key", () => {
    const bad: unknown[] = [
      {},
      null,
      "x",
      { ...validReport, relation: { relation: "boss" } },
      { ...validReport, relation: 5 },
      { ...validReport, location: { provinceCode: 32 } },
      { ...validReport, details: { title: 1, story: null, urgency: "now" } },
      { ...validReport, impact: { groups: "children" } },
      { ...validReport, evidence: [{}, { name: "a.exe", size: -1 }] },
      { ...validReport, evidence: "files" },
      { ...validReport, contact: { contactable: "yes", method: 12 } },
      { ...validReport, consent: { consents: "all" } },
      { ...validReport, consent: null },
    ]
    for (const input of bad) {
      const result = schema.safeParse(input)
      expect(result.success).toBe(false)
      for (const message of messages(result)) {
        expect(keys.has(message)).toBe(true)
      }
    }
  })
})

describe("step 1 relation", () => {
  test("self and witness need nothing else", () => {
    expect(relationStep.parse({ relation: "witness" })).toEqual({
      relation: "witness",
    })
  })

  test("on behalf requires the other person's consent", () => {
    const missing = relationStep.safeParse({ relation: "on_behalf" })
    expect(messages(missing)).toEqual(["error_other_consent_required"])
    expect(
      relationStep.parse({ relation: "on_behalf", otherConsent: "not_asked" }),
    ).toEqual({ relation: "on_behalf", otherConsent: "not_asked" })
  })

  test("stale conditional answer is dropped", () => {
    expect(
      relationStep.parse({ relation: "self", otherConsent: "yes" }),
    ).toEqual({ relation: "self" })
  })

  test("unknown relation", () => {
    expect(messages(relationStep.safeParse({ relation: "x" }))).toEqual([
      "error_relation_required",
    ])
  })
})

describe("step 2 location", () => {
  const base = validReport.location

  test("village is optional and empty becomes absent", () => {
    const parsed = locationStep.parse({ ...base, villageCode: "" })
    expect(parsed.villageCode).toBeUndefined()
  })

  test("codes must nest under the parent", () => {
    const result = locationStep.safeParse({ ...base, regencyCode: "33.01" })
    expect(messages(result)).toContain("error_region_mismatch")
    const village = locationStep.safeParse({
      ...base,
      villageCode: "32.73.02.1001",
    })
    expect(village.error?.issues[0]?.path).toEqual(["villageCode"])
  })

  test("format per level", () => {
    expect(
      messages(locationStep.safeParse({ ...base, districtCode: "32.73" })),
    ).toEqual(["error_district_required"])
  })

  test("point must be inside Indonesia", () => {
    expect(
      locationStep.safeParse({ ...base, point: { lat: -6.9, lng: 107.6 } })
        .success,
    ).toBe(true)
    expect(
      messages(
        locationStep.safeParse({ ...base, point: { lat: 51.5, lng: -0.1 } }),
      ),
    ).toContain("error_point_outside")
  })
})

describe("step 3 details", () => {
  const step = createDetailsStep(today)
  const base = validReport.details

  test("subcategory must belong to category", () => {
    const result = step.safeParse({ ...base, subcategoryId: "bencana.banjir" })
    expect(messages(result)).toEqual(["error_subcategory_mismatch"])
  })

  test("date cannot be in the future", () => {
    expect(step.safeParse({ ...base, occurredOn: today }).success).toBe(true)
    expect(
      messages(step.safeParse({ ...base, occurredOn: "2026-10-14" })),
    ).toEqual(["error_occurred_on_future"])
  })

  test("date cannot be before the minimum year", () => {
    expect(
      step.safeParse({ ...base, occurredOn: `${OCCURRED_ON_MIN_YEAR}-01-01` })
        .success,
    ).toBe(true)
    expect(
      messages(step.safeParse({ ...base, occurredOn: "0001-01-01" })),
    ).toEqual(["error_occurred_on_too_old"])
    expect(
      messages(
        step.safeParse({
          ...base,
          occurredOn: `${OCCURRED_ON_MIN_YEAR - 1}-12-31`,
        }),
      ),
    ).toEqual(["error_occurred_on_too_old"])
  })

  test("impossible date", () => {
    expect(
      messages(step.safeParse({ ...base, occurredOn: "2026-02-30" })),
    ).toEqual(["error_occurred_on_invalid"])
  })

  test("title and story lengths", () => {
    expect(messages(step.safeParse({ ...base, title: "   " }))).toEqual([
      "error_title_required",
    ])
    expect(messages(step.safeParse({ ...base, title: "Banjir" }))).toEqual([
      "error_title_too_short",
    ])
    expect(
      messages(step.safeParse({ ...base, story: "x".repeat(5001) })),
    ).toEqual(["error_story_too_long"])
  })

  test("trims and drops empty agency", () => {
    const parsed = step.parse({
      ...base,
      title: `  ${base.title} `,
      agency: "",
    })
    expect(parsed.title).toBe(base.title)
    expect(parsed.agency).toBeUndefined()
  })
})

describe("step 4 impact", () => {
  test("needs at least one group, removes duplicates", () => {
    const base = validReport.impact
    expect(messages(impactStep.safeParse({ ...base, groups: [] }))).toEqual([
      "error_groups_required",
    ])
    expect(
      impactStep.parse({ ...base, groups: ["women", "women"] }).groups,
    ).toEqual(["women"])
  })
})

describe("step 5 evidence", () => {
  test("optional and capped at five", () => {
    expect(evidenceStep.parse([])).toEqual([])
    const six = Array.from({ length: 6 }, (_, i) => ({
      name: `${i}.jpg`,
      size: 1000,
      type: "image/jpeg",
    }))
    expect(messages(evidenceStep.safeParse(six))).toContain(
      "error_evidence_too_many",
    )
  })

  test("size limit follows kind", () => {
    const big = { name: "a.pdf", size: 10 * MB + 1, type: "application/pdf" }
    expect(messages(evidenceStep.safeParse([big]))).toEqual([
      "error_evidence_too_large",
    ])
    const video = { name: "a.mp4", size: 40 * MB, type: "video/mp4" }
    expect(evidenceStep.parse([video])[0]?.kind).toBe("video")
  })

  test("video length and resolution", () => {
    const video = { name: "a.mp4", size: MB, type: "video/mp4" }
    expect(
      messages(evidenceStep.safeParse([{ ...video, durationSeconds: 181 }])),
    ).toEqual(["error_video_too_long"])
    expect(
      evidenceStep.safeParse([{ ...video, width: 1080, height: 1920 }]).success,
    ).toBe(true)
    expect(
      messages(
        evidenceStep.safeParse([{ ...video, width: 3840, height: 2160 }]),
      ),
    ).toEqual(["error_video_resolution"])
    // Long side counts too
    expect(
      messages(
        evidenceStep.safeParse([{ ...video, width: 2560, height: 1080 }]),
      ),
    ).toEqual(["error_video_resolution"])
  })

  test("unknown type", () => {
    expect(
      messages(
        evidenceStep.safeParse([{ name: "a.exe", size: 1, type: "x/y" }]),
      ),
    ).toEqual(["error_evidence_type"])
  })

  test("an extension that disagrees with the type", () => {
    for (const [name, type] of [
      ["Surat_Resmi.hta", "image/jpeg"],
      ["x.pdf", "video/mp4"],
    ]) {
      expect(
        messages(evidenceStep.safeParse([{ name, size: 1, type }])),
      ).toEqual(["error_evidence_type"])
    }
  })
})

describe("step 6 contact", () => {
  test("no contact needs nothing", () => {
    expect(contactStep.parse({ contactable: "no", phone: "0812" })).toEqual({
      contactable: "no",
    })
  })

  test("yes keeps the method, drops any number", () => {
    expect(
      contactStep.parse({
        contactable: "yes",
        phone: "0812-3456 7890",
        method: "whatsapp",
      }),
    ).toEqual({ contactable: "yes", method: "whatsapp" })
  })

  test("yes requires a method", () => {
    expect(messages(contactStep.safeParse({ contactable: "yes" }))).toEqual([
      "error_contact_method_required",
    ])
  })
})

describe("step 7 consent", () => {
  test("stores accepted keys and version", () => {
    expect(consentStep.parse(consent)).toEqual({
      consents: [
        "age_18_plus",
        "accurate",
        "public_issue",
        "aggregate_processing",
      ],
      consentTextVersion: CONSENT_TEXT_VERSION,
    })
  })

  test("a legacy forwarding box is dropped", () => {
    // Agency consent removed 25 Oct
    const parsed = consentStep.parse({
      ...consent,
      consents: { ...consent.consents, forward_to_agency: true },
    })
    expect(parsed.consents).toEqual([
      "age_18_plus",
      "accurate",
      "public_issue",
      "aggregate_processing",
    ])
  })

  test("every required box is required", () => {
    const result = consentStep.safeParse({
      consents: {},
      consentTextVersion: CONSENT_TEXT_VERSION,
    })
    expect(messages(result)).toEqual([
      "error_consent_age_required",
      "error_consent_accurate_required",
      "error_consent_public_issue_required",
      "error_consent_aggregate_required",
    ])
  })

  test("a string is not a checked box", () => {
    const result = consentStep.safeParse({
      ...consent,
      consents: { ...consent.consents, age_18_plus: "on" },
    })
    expect(messages(result)).toEqual(["error_consent_age_required"])
  })

  test("stale text version is refused", () => {
    expect(
      messages(
        consentStep.safeParse({ ...consent, consentTextVersion: "2020-01-01" }),
      ),
    ).toEqual(["error_consent_version_outdated"])
  })
})

describe("account age declaration", () => {
  test("requires the box and current version", () => {
    expect(
      ageDeclarationSchema.parse({
        age_18_plus: true,
        ageConsentVersion: AGE_CONSENT_VERSION,
      }),
    ).toEqual({ age_18_plus: true, ageConsentVersion: AGE_CONSENT_VERSION })
    expect(
      messages(
        ageDeclarationSchema.safeParse({
          ageConsentVersion: AGE_CONSENT_VERSION,
        }),
      ),
    ).toEqual(["error_consent_age_required"])
  })
})
