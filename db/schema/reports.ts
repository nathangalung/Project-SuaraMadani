import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { URGENCIES } from "../../shared/categories.ts"
import {
  EVIDENCE_DECISIONS,
  EVIDENCE_FAILURES,
  type EvidenceDecision,
  type EvidenceFailure,
  type PublicMedia,
  type RedactionBox,
} from "../../shared/evidence.ts"
import {
  AFFECTED_COUNTS,
  AFFECTED_GROUPS,
  CONTACT_METHODS,
  EVIDENCE_LIMITS,
  type EvidenceKind,
  MAX_EVIDENCE_FILES,
  ONGOING,
  OTHER_CONSENTS,
  RELATIONS,
} from "../../shared/report-fields.ts"
import { REPORT_STATUSES, type ReportStatus } from "../../shared/status.ts"
import { users } from "./auth.ts"
import {
  createdAt,
  oneOf,
  point4326,
  primaryId,
  tenantPolicy,
  textArray,
  updatedAt,
} from "./columns.ts"
import { organizations } from "./organizations.ts"
import { regions } from "./regions.ts"

// Consents the step-7 schema requires
export const REQUIRED_CONSENTS = [
  "age_18_plus",
  "accurate",
  "public_issue",
  "aggregate_processing",
] as const

export const EVIDENCE_KINDS = Object.keys(EVIDENCE_LIMITS) as EvidenceKind[]

export const EVIDENCE_STATUSES = [
  "awaiting_upload",
  "received",
  "ready",
  "missing",
  "rejected_limits",
  "needs_manual_review",
  // ClamAV hit, never shown
  "rejected_malware",
  "published",
] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]

const regionCode = (name: string) => text(name).references(() => regions.code)

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id)

export const reports = pgTable(
  "reports",
  {
    id: primaryId(),
    orgId: orgId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    publicCode: text("public_code").notNull(),
    submissionId: uuid("submission_id").notNull(),
    status: text("status").$type<ReportStatus>().notNull().default("submitted"),
    relation: text("relation").notNull(),
    otherConsent: text("other_consent"),
    provinceCode: regionCode("province_code").notNull(),
    regencyCode: regionCode("regency_code").notNull(),
    districtCode: regionCode("district_code").notNull(),
    villageCode: regionCode("village_code"),
    point: point4326("point"),
    title: text("title").notNull(),
    story: text("story").notNull(),
    categoryId: text("category_id").notNull(),
    subcategoryId: text("subcategory_id").notNull(),
    occurredOn: date("occurred_on").notNull(),
    agency: text("agency"),
    urgency: text("urgency").notNull(),
    affectedGroups: text("affected_groups").array().notNull(),
    affectedCount: text("affected_count").notNull(),
    ongoing: text("ongoing").notNull(),
    contactable: boolean("contactable").notNull(),
    consents: text("consents").array().notNull(),
    consentTextVersion: text("consent_text_version").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Kept after merge for label
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // Copy from another campus
    forwardedFromOrgId: uuid("forwarded_from_org_id").references(
      () => organizations.id,
    ),
    // No FK: other tenant's row
    forwardedFromReportId: uuid("forwarded_from_report_id"),
    // Code the reporter knows
    forwardedFromCode: text("forwarded_from_code"),
    forwardedToOrgId: uuid("forwarded_to_org_id").references(
      () => organizations.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("reports_org_id_id_key").on(t.orgId, t.id),
    unique("reports_org_id_public_code_key").on(t.orgId, t.publicCode),
    unique("reports_submission_key").on(t.orgId, t.userId, t.submissionId),
    // Repeated forward is a no-op
    unique("reports_forwarded_from_key").on(t.orgId, t.forwardedFromReportId),
    index("reports_queue_idx").on(t.orgId, t.status, t.createdAt),
    index("reports_user_idx").on(t.orgId, t.userId, t.createdAt),
    check("reports_status_check", oneOf(t.status, REPORT_STATUSES)),
    check(
      "reports_forwarded_from_check",
      sql`(${t.forwardedFromOrgId} IS NULL) = (${t.forwardedFromReportId} IS NULL)`,
    ),
    check(
      "reports_forwarded_to_check",
      sql`${t.forwardedToOrgId} IS NULL OR ${t.status} = 'forwarded'`,
    ),
    check("reports_relation_check", oneOf(t.relation, RELATIONS)),
    check(
      "reports_other_consent_check",
      sql`(${t.relation} = 'on_behalf') = (${t.otherConsent} IS NOT NULL) AND (${t.otherConsent} IS NULL OR ${oneOf(t.otherConsent, OTHER_CONSENTS)})`,
    ),
    check(
      "reports_subcategory_check",
      sql`starts_with(${t.subcategoryId}, ${t.categoryId} || '.')`,
    ),
    check("reports_urgency_check", oneOf(t.urgency, URGENCIES)),
    check(
      "reports_affected_groups_check",
      sql`cardinality(${t.affectedGroups}) > 0 AND ${t.affectedGroups} <@ ${textArray(AFFECTED_GROUPS)}`,
    ),
    check(
      "reports_affected_count_check",
      oneOf(t.affectedCount, AFFECTED_COUNTS),
    ),
    check("reports_ongoing_check", oneOf(t.ongoing, ONGOING)),
    check(
      "reports_consents_check",
      sql`${t.consents} @> ${textArray(REQUIRED_CONSENTS)}`,
    ),
    tenantPolicy(),
  ],
)

// Contact data, staff read only
export const reportContacts = pgTable(
  "report_contacts",
  {
    id: primaryId(),
    orgId: orgId(),
    reportId: uuid("report_id").notNull().unique(),
    phone: text("phone").notNull(),
    method: text("method").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "report_contacts_report_fk",
      columns: [t.orgId, t.reportId],
      foreignColumns: [reports.orgId, reports.id],
    }).onDelete("cascade"),
    check("report_contacts_method_check", oneOf(t.method, CONTACT_METHODS)),
    tenantPolicy(),
    // Reporter inserts, never reads back
    pgPolicy("staff_only", {
      as: "restrictive",
      for: "all",
      using: sql`current_setting('app.member_role', true) = 'admin'`,
      withCheck: sql`true`,
    }),
  ],
)

export const evidence = pgTable(
  "evidence",
  {
    id: primaryId(),
    orgId: orgId(),
    reportId: uuid("report_id").notNull(),
    position: smallint("position").notNull(),
    kind: text("kind").$type<EvidenceKind>().notNull(),
    declaredName: text("declared_name").notNull(),
    declaredType: text("declared_type").notNull(),
    declaredSize: bigint("declared_size", { mode: "number" }).notNull(),
    status: text("status")
      .$type<EvidenceStatus>()
      .notNull()
      .default("awaiting_upload"),
    detectedType: text("detected_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    sha256: text("sha256"),
    attempts: smallint("attempts").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    // ClamAV clean verdict, PDF only
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    failureReason: text("failure_reason").$type<EvidenceFailure>(),
    // Source media, from ffprobe
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    // PDF pages in the file
    sourcePages: integer("source_pages"),
    // Rendered previews in files/derived
    previewPages: smallint("preview_pages").notNull().default(0),
    decision: text("decision").$type<EvidenceDecision>(),
    redactionBoxes: jsonb("redaction_boxes")
      .$type<RedactionBox[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    publishPages: smallint("publish_pages").array(),
    // No FK: rows outlive users
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    publicMedia: jsonb("public_media").$type<PublicMedia[]>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("evidence_report_position_key").on(t.reportId, t.position),
    index("evidence_status_idx").on(t.orgId, t.status),
    // Per-tenant 24 h byte cap
    index("evidence_received_idx").on(t.orgId, t.receivedAt),
    foreignKey({
      name: "evidence_report_fk",
      columns: [t.orgId, t.reportId],
      foreignColumns: [reports.orgId, reports.id],
    }).onDelete("cascade"),
    check(
      "evidence_position_check",
      sql`${t.position} >= 0 AND ${t.position} < ${sql.raw(String(MAX_EVIDENCE_FILES))}`, // sql-raw-ok: constant
    ),
    check("evidence_kind_check", oneOf(t.kind, EVIDENCE_KINDS)),
    check("evidence_status_check", oneOf(t.status, EVIDENCE_STATUSES)),
    check("evidence_declared_size_check", sql`${t.declaredSize} > 0`),
    check(
      "evidence_failure_reason_check",
      sql`${t.failureReason} IS NULL OR ${oneOf(t.failureReason, EVIDENCE_FAILURES)}`,
    ),
    check(
      "evidence_decision_check",
      sql`${t.decision} IS NULL OR ${oneOf(t.decision, EVIDENCE_DECISIONS)}`,
    ),
    check(
      "evidence_decided_check",
      sql`(${t.decision} IS NULL) = (${t.decidedAt} IS NULL)`,
    ),
    check(
      "evidence_published_check",
      sql`(${t.status} = 'published') = (${t.publishedAt} IS NOT NULL)`,
    ),
    tenantPolicy(),
  ],
)
