// Explicit maps keep tree-shaking
import { m } from "~/paraglide/messages.js"
import type {
  CategoryId,
  SubcategoryGroup,
  Urgency,
} from "../../../shared/categories.ts"
import {
  AGENCY_MAX_LENGTH,
  EVIDENCE_LIMITS,
  MAX_EVIDENCE_FILES,
  OCCURRED_ON_MIN_YEAR,
  type ReportErrorKey,
  type ReportStep,
  STORY_LENGTH,
  TITLE_LENGTH,
} from "../../../shared/report-fields.ts"
import type { Text } from "./public-labels"

const MB = 1024 * 1024

export const ERROR_TEXT: Record<ReportErrorKey, Text> = {
  error_step_required: m.error_step_required,
  error_submission_id: m.error_submission_id,
  error_relation_required: m.error_relation_required,
  error_other_consent_required: m.error_other_consent_required,
  error_province_required: m.error_province_required,
  error_regency_required: m.error_regency_required,
  error_district_required: m.error_district_required,
  error_village_format: m.error_village_format,
  error_region_mismatch: m.error_region_mismatch,
  error_point_outside: m.error_point_outside,
  error_title_required: m.error_title_required,
  error_title_too_short: () =>
    m.error_title_too_short({ min: TITLE_LENGTH.min }),
  error_title_too_long: () => m.error_title_too_long({ max: TITLE_LENGTH.max }),
  error_story_required: m.error_story_required,
  error_story_too_short: () =>
    m.error_story_too_short({ min: STORY_LENGTH.min }),
  error_story_too_long: () => m.error_story_too_long({ max: STORY_LENGTH.max }),
  error_category_required: m.error_category_required,
  error_subcategory_required: m.error_subcategory_required,
  error_subcategory_mismatch: m.error_subcategory_mismatch,
  error_occurred_on_invalid: m.error_occurred_on_invalid,
  error_occurred_on_future: m.error_occurred_on_future,
  error_occurred_on_too_old: () =>
    m.error_occurred_on_too_old({ min: OCCURRED_ON_MIN_YEAR }),
  error_agency_too_long: () =>
    m.error_agency_too_long({ max: AGENCY_MAX_LENGTH }),
  error_urgency_required: m.error_urgency_required,
  error_groups_required: m.error_groups_required,
  error_affected_count_required: m.error_affected_count_required,
  error_ongoing_required: m.error_ongoing_required,
  error_evidence_invalid: m.error_evidence_invalid,
  error_evidence_type: m.error_evidence_type,
  error_evidence_too_large: () =>
    m.error_evidence_too_large({
      max: EVIDENCE_LIMITS.image / MB,
      videoMax: EVIDENCE_LIMITS.video / MB,
    }),
  error_evidence_too_many: () =>
    m.error_evidence_too_many({ max: MAX_EVIDENCE_FILES }),
  error_video_too_long: m.error_video_too_long,
  error_video_resolution: m.error_video_resolution,
  error_contactable_required: m.error_contactable_required,
  error_contact_no_phone: m.error_contact_no_phone,
  error_contact_phone_unverified: m.error_contact_phone_unverified,
  error_contact_method_required: m.error_contact_method_required,
  error_consent_age_required: m.error_consent_age_required,
  error_consent_accurate_required: m.error_consent_accurate_required,
  error_consent_public_issue_required: m.error_consent_public_issue_required,
  error_consent_aggregate_required: m.error_consent_aggregate_required,
  error_consent_version_outdated: m.error_consent_version_outdated,
}

export const CATEGORY_HINT_TEXT: Record<CategoryId, Text> = {
  program: m.category_program_hint,
  bencana: m.category_bencana_hint,
  bansos: m.category_bansos_hint,
}

export const SUBGROUP_TEXT: Record<SubcategoryGroup, Text> = {
  layanan_dasar: m.subgroup_layanan_dasar,
  infrastruktur_utilitas: m.subgroup_infrastruktur_utilitas,
  ekonomi_kebijakan: m.subgroup_ekonomi_kebijakan,
}

export const URGENCY_TEXT: Record<Urgency, Text> = {
  low: m.urgency_low,
  medium: m.urgency_medium,
  high: m.urgency_high,
  emergency: m.urgency_emergency,
}

export const RELATION_TEXT = {
  self: m.relation_self,
  on_behalf: m.relation_on_behalf,
  witness: m.relation_witness,
} as const

export const RELATION_HINT_TEXT = {
  self: m.relation_self_hint,
  on_behalf: m.relation_on_behalf_hint,
  witness: m.relation_witness_hint,
} as const

// One name, list and review
export const STEP_TITLE_TEXT: Record<ReportStep, Text> = {
  relation: m.step_relation_title,
  location: m.step_location_title,
  details: m.step_details_title,
  impact: m.step_impact_title,
  evidence: m.step_evidence_title,
  contact: m.step_contact_title,
  consent: m.step_review_title,
}

export const STEP_DESC_TEXT: Record<ReportStep, Text> = {
  relation: m.step_relation_desc,
  location: m.step_location_desc,
  details: m.step_details_desc,
  impact: m.step_impact_desc,
  evidence: m.step_evidence_desc,
  contact: m.step_contact_desc,
  consent: m.step_review_desc,
}

export const OTHER_CONSENT_TEXT = {
  yes: m.other_consent_yes,
  not_asked: m.other_consent_not_asked,
  cannot_ask: m.other_consent_cannot_ask,
} as const

export const GROUP_TEXT = {
  children: m.group_children,
  elderly: m.group_elderly,
  people_with_disabilities: m.group_people_with_disabilities,
  women: m.group_women,
  students: m.group_students,
  workers: m.group_workers,
  farmers_fishers: m.group_farmers_fishers,
  general_public: m.group_general_public,
} as const

export const COUNT_TEXT = {
  "1_10": m.count_1_10,
  "11_100": m.count_11_100,
  "101_1000": m.count_101_1000,
  "1001_10000": m.count_1001_10000,
  over_10000: m.count_over_10000,
  unknown: m.count_unknown,
} as const

export const ONGOING_TEXT = {
  yes: m.ongoing_yes,
  no: m.ongoing_no,
  unknown: m.ongoing_unknown,
} as const

export const CONTACTABLE_TEXT = {
  yes: m.contact_yes,
  no: m.contact_no,
} as const

export const METHOD_TEXT = {
  whatsapp: m.method_whatsapp,
  phone: m.method_phone,
} as const
