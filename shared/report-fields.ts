// Zod-free for small client chunks.

// Messages are keys for messages/id.json.
export const REPORT_ERROR_KEYS = [
  "error_step_required",
  "error_submission_id",
  "error_relation_required",
  "error_other_consent_required",
  "error_province_required",
  "error_regency_required",
  "error_district_required",
  "error_village_format",
  "error_region_mismatch",
  "error_point_outside",
  "error_title_required",
  "error_title_too_short",
  "error_title_too_long",
  "error_story_required",
  "error_story_too_short",
  "error_story_too_long",
  "error_category_required",
  "error_subcategory_required",
  "error_subcategory_mismatch",
  "error_occurred_on_invalid",
  "error_occurred_on_future",
  "error_occurred_on_too_old",
  "error_agency_too_long",
  "error_urgency_required",
  "error_groups_required",
  "error_affected_count_required",
  "error_ongoing_required",
  "error_evidence_invalid",
  "error_evidence_type",
  "error_evidence_too_large",
  "error_evidence_too_many",
  "error_video_too_long",
  "error_video_resolution",
  "error_contactable_required",
  "error_contact_no_phone",
  "error_contact_phone_unverified",
  "error_contact_method_required",
  "error_consent_age_required",
  "error_consent_accurate_required",
  "error_consent_public_issue_required",
  "error_consent_aggregate_required",
  "error_consent_version_outdated",
] as const
export type ReportErrorKey = (typeof REPORT_ERROR_KEYS)[number]

export const REPORT_STEPS = [
  "relation",
  "location",
  "details",
  "impact",
  "evidence",
  "contact",
  "consent",
] as const
export type ReportStep = (typeof REPORT_STEPS)[number]

// Bump when step-7 text changes.
export const CONSENT_TEXT_VERSION = "2026-10-13"
// Bump on age text change.
export const AGE_CONSENT_VERSION = "2026-10-13"

// Starting Values: public suppression k
export const DISTRICT_MIN_REPORTS = 5

export const CONSENT_KEYS = [
  "age_18_plus",
  "accurate",
  "public_issue",
  "aggregate_processing",
  "forward_to_agency",
] as const
export type ConsentKey = (typeof CONSENT_KEYS)[number]

export const RELATIONS = ["self", "on_behalf", "witness"] as const
export const OTHER_CONSENTS = ["yes", "not_asked", "cannot_ask"] as const
export const AFFECTED_GROUPS = [
  "children",
  "elderly",
  "people_with_disabilities",
  "women",
  "students",
  "workers",
  "farmers_fishers",
  "general_public",
] as const
export const AFFECTED_COUNTS = [
  "1_10",
  "11_100",
  "101_1000",
  "1001_10000",
  "over_10000",
  "unknown",
] as const
export const ONGOING = ["yes", "no", "unknown"] as const
export const CONTACT_METHODS = ["whatsapp", "phone"] as const

export const TITLE_LENGTH = { min: 10, max: 120 } as const
export const STORY_LENGTH = { min: 40, max: 5000 } as const
export const AGENCY_MAX_LENGTH = 200

// Rough Indonesia bounding box
export const INDONESIA_BOUNDS = {
  south: -11.5,
  north: 6.5,
  west: 94,
  east: 141.5,
} as const
export type LatLng = { lat: number; lng: number }

export function inIndonesia({ lat, lng }: LatLng): boolean {
  const { south, north, west, east } = INDONESIA_BOUNDS
  return lat >= south && lat <= north && lng >= west && lng <= east
}
// Catches mistyped years
export const OCCURRED_ON_MIN_YEAR = 1900

const MB = 1024 * 1024
export const MAX_EVIDENCE_FILES = 5
export const EVIDENCE_LIMITS = { image: 10 * MB, pdf: 10 * MB, video: 50 * MB }
export const MAX_VIDEO_SECONDS = 180
export const MAX_VIDEO_SHORT_SIDE = 1080
// Two full decodes: 0.75 GB
export const MAX_FULL_DECODE_PIXELS = 100_000_000
export type EvidenceKind = keyof typeof EVIDENCE_LIMITS

const KIND_BY_TYPE = new Map<string, EvidenceKind>([
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
  ["image/heic", "image"],
  ["image/heif", "image"],
  ["application/pdf", "pdf"],
  ["video/mp4", "video"],
  ["video/quicktime", "video"],
  ["video/webm", "video"],
])

// Some browsers omit HEIC types.
const KIND_BY_EXTENSION = new Map<string, EvidenceKind>([
  ["jpg", "image"],
  ["jpeg", "image"],
  ["jpe", "image"],
  ["jfif", "image"],
  ["png", "image"],
  ["webp", "image"],
  ["heic", "image"],
  ["heif", "image"],
  ["pdf", "pdf"],
  ["mp4", "video"],
  ["mov", "video"],
  ["webm", "video"],
])

/** Client hint, server sniffs bytes. */
export function evidenceKind(file: {
  type: string
  name: string
}): EvidenceKind | undefined {
  const dot = file.name.lastIndexOf(".")
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ""
  const byName = KIND_BY_EXTENSION.get(extension)
  if (file.type === "") return byName
  const byType = KIND_BY_TYPE.get(file.type.toLowerCase())
  // ASVS V5.2.2: extension must agree
  return extension === "" || byName === byType ? byType : undefined
}
