import * as z from "zod"
import {
  CATEGORY_IDS,
  categoryOf,
  isCategoryId,
  isSubcategoryId,
  SUBCATEGORY_IDS,
  URGENCIES,
} from "./categories.ts"
import { videoLimitError } from "./evidence.ts"
import {
  AFFECTED_COUNTS,
  AFFECTED_GROUPS,
  AGE_CONSENT_VERSION,
  AGENCY_MAX_LENGTH,
  CONSENT_KEYS,
  CONSENT_TEXT_VERSION,
  CONTACT_METHODS,
  EVIDENCE_LIMITS,
  evidenceKind,
  INDONESIA_BOUNDS,
  MAX_EVIDENCE_FILES,
  OCCURRED_ON_MIN_YEAR,
  ONGOING,
  OTHER_CONSENTS,
  type ReportErrorKey,
  STORY_LENGTH,
  TITLE_LENGTH,
} from "./report-fields.ts"

function e(key: ReportErrorKey) {
  return { error: key }
}

// Stop checks on empty input.
function required(key: ReportErrorKey) {
  return { error: key, abort: true }
}

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value
}

export const relationStep = z.discriminatedUnion(
  "relation",
  [
    z.object({
      relation: z.literal("on_behalf"),
      otherConsent: z.enum(OTHER_CONSENTS, e("error_other_consent_required")),
    }),
    z.object({ relation: z.enum(["self", "witness"]) }),
  ],
  e("error_relation_required"),
)

const PROVINCE = /^\d{2}$/
const REGENCY = /^\d{2}\.\d{2}$/
const DISTRICT = /^\d{2}\.\d{2}\.\d{2}$/
const VILLAGE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/

function isCode(value: unknown, format: RegExp): value is string {
  return typeof value === "string" && format.test(value)
}

// Rough Indonesia bounding box.
export const pointSchema = z.object(
  {
    lat: z
      .number(e("error_point_outside"))
      .min(INDONESIA_BOUNDS.south, e("error_point_outside"))
      .max(INDONESIA_BOUNDS.north, e("error_point_outside")),
    lng: z
      .number(e("error_point_outside"))
      .min(INDONESIA_BOUNDS.west, e("error_point_outside"))
      .max(INDONESIA_BOUNDS.east, e("error_point_outside")),
  },
  e("error_point_outside"),
)

export const locationStep = z
  .object(
    {
      provinceCode: z
        .string(e("error_province_required"))
        .regex(PROVINCE, e("error_province_required")),
      regencyCode: z
        .string(e("error_regency_required"))
        .regex(REGENCY, e("error_regency_required")),
      districtCode: z
        .string(e("error_district_required"))
        .regex(DISTRICT, e("error_district_required")),
      villageCode: z.preprocess(
        emptyToUndefined,
        z
          .string(e("error_village_format"))
          .regex(VILLAGE, e("error_village_format"))
          .optional(),
      ),
      point: pointSchema.optional(),
    },
    e("error_step_required"),
  )
  .superRefine((value, ctx) => {
    // Kemendagri codes nest by prefix.
    const chain = [
      ["regencyCode", value.provinceCode, PROVINCE, value.regencyCode, REGENCY],
      [
        "districtCode",
        value.regencyCode,
        REGENCY,
        value.districtCode,
        DISTRICT,
      ],
      ["villageCode", value.districtCode, DISTRICT, value.villageCode, VILLAGE],
    ] as const
    for (const [field, parent, parentFormat, child, childFormat] of chain) {
      if (!isCode(parent, parentFormat) || !isCode(child, childFormat)) return
      if (!child.startsWith(`${parent}.`)) {
        ctx.addIssue({
          code: "custom",
          message: "error_region_mismatch",
          path: [field],
        })
        return
      }
    }
  })

/** today is latestIsoDate(now). */
export function createDetailsStep(today: string) {
  return z
    .object(
      {
        title: z
          .string(e("error_title_required"))
          .trim()
          .min(1, required("error_title_required"))
          .min(TITLE_LENGTH.min, e("error_title_too_short"))
          .max(TITLE_LENGTH.max, e("error_title_too_long")),
        story: z
          .string(e("error_story_required"))
          .trim()
          .min(1, required("error_story_required"))
          .min(STORY_LENGTH.min, e("error_story_too_short"))
          .max(STORY_LENGTH.max, e("error_story_too_long")),
        categoryId: z.enum(CATEGORY_IDS, e("error_category_required")),
        subcategoryId: z.enum(SUBCATEGORY_IDS, e("error_subcategory_required")),
        occurredOn: z.iso
          .date(e("error_occurred_on_invalid"))
          .refine((date) => date <= today, e("error_occurred_on_future"))
          .refine(
            (date) => Number(date.slice(0, 4)) >= OCCURRED_ON_MIN_YEAR,
            e("error_occurred_on_too_old"),
          ),
        agency: z.preprocess(
          emptyToUndefined,
          z
            .string(e("error_agency_too_long"))
            .trim()
            .max(AGENCY_MAX_LENGTH, e("error_agency_too_long"))
            .optional(),
        ),
        urgency: z.enum(URGENCIES, e("error_urgency_required")),
      },
      e("error_step_required"),
    )
    .superRefine((value, ctx) => {
      // Runs even when fields failed.
      if (!isCategoryId(value.categoryId)) return
      if (!isSubcategoryId(value.subcategoryId)) return
      if (categoryOf(value.subcategoryId) !== value.categoryId) {
        ctx.addIssue({
          code: "custom",
          message: "error_subcategory_mismatch",
          path: ["subcategoryId"],
        })
      }
    })
}

export const impactStep = z.object(
  {
    groups: z
      .array(
        z.enum(AFFECTED_GROUPS, e("error_groups_required")),
        e("error_groups_required"),
      )
      .min(1, e("error_groups_required"))
      .transform((groups) => [...new Set(groups)]),
    affectedCount: z.enum(AFFECTED_COUNTS, e("error_affected_count_required")),
    ongoing: z.enum(ONGOING, e("error_ongoing_required")),
  },
  e("error_step_required"),
)

const evidenceFile = z
  .object(
    {
      name: z
        .string(e("error_evidence_invalid"))
        .trim()
        .min(1, e("error_evidence_invalid"))
        .max(255, e("error_evidence_invalid")),
      size: z
        .number(e("error_evidence_invalid"))
        .int(e("error_evidence_invalid"))
        .positive(e("error_evidence_invalid")),
      type: z.string(e("error_evidence_type")),
      durationSeconds: z
        .number(e("error_evidence_invalid"))
        .nonnegative(e("error_evidence_invalid"))
        .optional(),
      width: z
        .number(e("error_evidence_invalid"))
        .int(e("error_evidence_invalid"))
        .positive(e("error_evidence_invalid"))
        .optional(),
      height: z
        .number(e("error_evidence_invalid"))
        .int(e("error_evidence_invalid"))
        .positive(e("error_evidence_invalid"))
        .optional(),
    },
    e("error_evidence_invalid"),
  )
  .transform((file, ctx) => {
    const fail = (message: ReportErrorKey) => {
      ctx.issues.push({ code: "custom", message, input: file })
      return z.NEVER
    }
    const kind = evidenceKind(file)
    if (kind === undefined) return fail("error_evidence_type")
    if (file.size > EVIDENCE_LIMITS[kind])
      return fail("error_evidence_too_large")
    if (kind === "video") {
      // Browser metadata, worker re-checks.
      const limit = videoLimitError(file)
      if (limit) return fail(limit)
    }
    return { ...file, kind }
  })

export const evidenceStep = z
  .array(evidenceFile, e("error_evidence_invalid"))
  .max(MAX_EVIDENCE_FILES, e("error_evidence_too_many"))

export const contactStep = z.discriminatedUnion(
  "contactable",
  [
    z.object({
      contactable: z.literal("yes"),
      // Number comes from the account
      method: z.enum(CONTACT_METHODS, e("error_contact_method_required")),
    }),
    z.object({ contactable: z.literal("no") }),
  ],
  e("error_contactable_required"),
)

const ageBox = z.literal(true, e("error_consent_age_required"))

export const consentStep = z
  .object(
    {
      consents: z.object(
        {
          age_18_plus: ageBox,
          accurate: z.literal(true, e("error_consent_accurate_required")),
          public_issue: z.literal(
            true,
            e("error_consent_public_issue_required"),
          ),
          aggregate_processing: z.literal(
            true,
            e("error_consent_aggregate_required"),
          ),
        },
        e("error_step_required"),
      ),
      consentTextVersion: z.literal(
        CONSENT_TEXT_VERSION,
        e("error_consent_version_outdated"),
      ),
    },
    e("error_step_required"),
  )
  .transform(({ consents, consentTextVersion }) => ({
    consents: CONSENT_KEYS.filter((key) => consents[key] === true),
    consentTextVersion,
  }))

/** Every account creation path. */
export const ageDeclarationSchema = z.object(
  {
    age_18_plus: ageBox,
    ageConsentVersion: z.literal(
      AGE_CONSENT_VERSION,
      e("error_consent_version_outdated"),
    ),
  },
  e("error_step_required"),
)

export function createReportSchema(today: string) {
  return z.object(
    {
      submissionId: z.uuid(e("error_submission_id")),
      relation: relationStep,
      location: locationStep,
      details: createDetailsStep(today),
      impact: impactStep,
      evidence: evidenceStep.default([]),
      contact: contactStep,
      consent: consentStep,
    },
    e("error_step_required"),
  )
}

type ReportSchema = ReturnType<typeof createReportSchema>
export type Report = z.output<ReportSchema>
