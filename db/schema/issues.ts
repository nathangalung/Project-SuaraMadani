import { desc, type SQL, sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import {
  CLAIM_BASES,
  CLAIM_OUTCOMES,
  type ClaimBasis,
  type ClaimOutcome,
} from "../../shared/claims.ts"
import {
  STANDARD_REASONS,
  type StandardReason,
  TAKEDOWN_REASONS,
  type TakedownReason,
} from "../../shared/complaints.ts"
import {
  ESCALATION_CHANNELS,
  type EscalationChannel,
  ISSUE_EVENT_ACTIONS,
  type IssueEventAction,
  REFERRAL_CHANNELS,
  REFERRAL_KINDS,
  type ReferralChannel,
  type ReferralKind,
} from "../../shared/moderation.ts"
import {
  ADVOCACY_STATUSES,
  type AdvocacyStatus,
  GOVERNMENT_STATUSES,
  type GovernmentStatus,
  VERIFICATION_LABELS,
  type VerificationLabel,
} from "../../shared/status.ts"
import {
  createdAt,
  oneOf,
  primaryId,
  tenantPolicy,
  tsvector,
  updatedAt,
} from "./columns.ts"
import { organizations } from "./organizations.ts"
import { regions } from "./regions.ts"
import { reports } from "./reports.ts"

const regionCode = (name: string) => text(name).references(() => regions.code)

export const issues = pgTable(
  "issues",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    year: smallint("year").notNull(),
    // 0: before monthly codes
    month: smallint("month").notNull().default(0),
    number: integer("number").notNull(),
    publicCode: text("public_code").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    // Stored, so search skips recompute
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`to_tsvector('indonesian', ${issues.title} || ' ' || ${issues.summary})`,
      ),
    categoryId: text("category_id").notNull(),
    subcategoryId: text("subcategory_id").notNull(),
    provinceCode: regionCode("province_code").notNull(),
    regencyCode: regionCode("regency_code").notNull(),
    // Shown at k reports
    districtCode: regionCode("district_code"),
    advocacyStatus: text("advocacy_status")
      .$type<AdvocacyStatus>()
      .notNull()
      .default("monitoring"),
    govStatus: text("gov_status")
      .$type<GovernmentStatus>()
      .notNull()
      .default("awaiting_response"),
    verificationLabel: text("verification_label")
      .$type<VerificationLabel>()
      .notNull()
      .default("unverified"),
    reportCount: integer("report_count").notNull().default(0),
    verifiedReportCount: integer("verified_report_count").notNull().default(0),
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Disunting admin line, PLAN §5.10
    redactedAt: timestamp("redacted_at", { withTimezone: true }),
    redactionReason: text("redaction_reason").$type<StandardReason>(),
    // Removed for good, never republished
    takenDownAt: timestamp("taken_down_at", { withTimezone: true }),
    takedownReason: text("takedown_reason").$type<TakedownReason>(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("issues_org_id_id_key").on(t.orgId, t.id),
    unique("issues_org_id_public_code_key").on(t.orgId, t.publicCode),
    unique("issues_number_key").on(t.orgId, t.year, t.month, t.number),
    // One per sort, keyset id
    index("issues_published_idx")
      .on(t.orgId, desc(t.publishedAt), desc(t.id))
      .where(sql`${t.publishedAt} IS NOT NULL`),
    index("issues_report_count_idx")
      .on(t.orgId, desc(t.reportCount), desc(t.id))
      .where(sql`${t.publishedAt} IS NOT NULL`),
    // Also merge targets, unpublished
    index("issues_activity_idx").on(
      t.orgId,
      desc(t.lastActivityAt),
      desc(t.id),
    ),
    check("issues_advocacy_check", oneOf(t.advocacyStatus, ADVOCACY_STATUSES)),
    check("issues_gov_check", oneOf(t.govStatus, GOVERNMENT_STATUSES)),
    check(
      "issues_verification_check",
      oneOf(t.verificationLabel, VERIFICATION_LABELS),
    ),
    check(
      "issues_subcategory_check",
      sql`starts_with(${t.subcategoryId}, ${t.categoryId} || '.')`,
    ),
    check("issues_version_check", sql`${t.version} > 0`),
    check(
      "issues_redaction_check",
      sql`(${t.redactedAt} IS NULL) = (${t.redactionReason} IS NULL) AND (${t.redactionReason} IS NULL OR ${oneOf(t.redactionReason, STANDARD_REASONS)})`,
    ),
    check(
      "issues_takedown_check",
      sql`(${t.takenDownAt} IS NULL) = (${t.takedownReason} IS NULL) AND (${t.takedownReason} IS NULL OR ${oneOf(t.takedownReason, TAKEDOWN_REASONS)}) AND (${t.takenDownAt} IS NULL OR ${t.publishedAt} IS NULL)`,
    ),
    tenantPolicy(),
  ],
)

export const issueReports = pgTable(
  "issue_reports",
  {
    orgId: uuid("org_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    reportId: uuid("report_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.reportId] }),
    // One issue per report
    unique("issue_reports_report_key").on(t.orgId, t.reportId),
    foreignKey({
      name: "issue_reports_issue_fk",
      columns: [t.orgId, t.issueId],
      foreignColumns: [issues.orgId, issues.id],
    }),
    foreignKey({
      name: "issue_reports_report_fk",
      columns: [t.orgId, t.reportId],
      foreignColumns: [reports.orgId, reports.id],
    }),
    tenantPolicy(),
  ],
)

const issueRef = (
  name: string,
  t: { orgId: AnyPgColumn; issueId: AnyPgColumn },
) =>
  foreignKey({
    name,
    columns: [t.orgId, t.issueId],
    foreignColumns: [issues.orgId, issues.id],
  }).onDelete("cascade")

const orgRef = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id)

// Referral or escalation, PLAN §5.4
export const referrals = pgTable(
  "referrals",
  {
    id: primaryId(),
    orgId: orgRef(),
    issueId: uuid("issue_id").notNull(),
    kind: text("kind").$type<ReferralKind>().notNull(),
    agency: text("agency").notNull(),
    channel: text("channel")
      .$type<ReferralChannel | EscalationChannel>()
      .notNull(),
    ticket: text("ticket"),
    sentOn: date("sent_on").notNull(),
    // Escalations may have none
    deadlineOn: date("deadline_on"),
    // No FK: rows outlive users
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("referrals_org_id_id_key").on(t.orgId, t.id),
    index("referrals_issue_idx").on(t.orgId, t.issueId, desc(t.sentOn)),
    issueRef("referrals_issue_fk", t),
    check("referrals_kind_check", oneOf(t.kind, REFERRAL_KINDS)),
    check(
      "referrals_channel_check",
      sql`(${t.kind} = 'referral' AND ${oneOf(t.channel, REFERRAL_CHANNELS)}) OR (${t.kind} = 'escalation' AND ${oneOf(t.channel, ESCALATION_CHANNELS)})`,
    ),
    check(
      "referrals_deadline_check",
      sql`(${t.kind} = 'escalation' OR ${t.deadlineOn} IS NOT NULL) AND (${t.deadlineOn} IS NULL OR ${t.deadlineOn} >= ${t.sentOn})`,
    ),
    tenantPolicy(),
  ],
)

// Agency reply, shown in full
export const responses = pgTable(
  "responses",
  {
    id: primaryId(),
    orgId: orgRef(),
    issueId: uuid("issue_id").notNull(),
    agency: text("agency").notNull(),
    body: text("body").notNull(),
    respondedOn: date("responded_on").notNull(),
    sourceUrl: text("source_url").notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("responses_org_id_id_key").on(t.orgId, t.id),
    index("responses_issue_idx").on(t.orgId, t.issueId, desc(t.respondedOn)),
    issueRef("responses_issue_fk", t),
    check("responses_source_check", sql`${t.sourceUrl} ~ '^https?://'`),
    tenantPolicy(),
  ],
)

// One per claim, PLAN §5.7
export const resolutionClaims = pgTable(
  "resolution_claims",
  {
    id: primaryId(),
    orgId: orgRef(),
    issueId: uuid("issue_id").notNull(),
    // No FK: rows outlive users
    claimedBy: uuid("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Survey mail queued
    surveySentAt: timestamp("survey_sent_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    outcome: text("outcome").$type<ClaimOutcome>(),
    basis: text("basis").$type<ClaimBasis>(),
    closedBy: uuid("closed_by"),
    // Admin confirm, linked proof
    evidenceUrl: text("evidence_url"),
    // Top prefix before hash clear
    maxPrefixRatings: integer("max_prefix_ratings"),
  },
  (t) => [
    unique("resolution_claims_org_id_id_key").on(t.orgId, t.id),
    // One open claim per issue
    uniqueIndex("resolution_claims_open_key")
      .on(t.orgId, t.issueId)
      .where(sql`${t.closedAt} IS NULL`),
    index("resolution_claims_issue_idx").on(
      t.orgId,
      t.issueId,
      desc(t.claimedAt),
    ),
    issueRef("resolution_claims_issue_fk", t),
    check(
      "resolution_claims_outcome_check",
      sql`${t.outcome} IS NULL OR ${oneOf(t.outcome, CLAIM_OUTCOMES)}`,
    ),
    check(
      "resolution_claims_basis_check",
      sql`${t.basis} IS NULL OR ${oneOf(t.basis, CLAIM_BASES)}`,
    ),
    check(
      "resolution_claims_closed_check",
      sql`(${t.closedAt} IS NULL) = (${t.outcome} IS NULL) AND (${t.closedAt} IS NULL) = (${t.basis} IS NULL)`,
    ),
    check(
      "resolution_claims_evidence_check",
      sql`${t.evidenceUrl} IS NULL OR (${t.evidenceUrl} ~ '^https?://' AND ${t.outcome} = 'confirmed' AND ${t.basis} = 'admin')`,
    ),
    tenantPolicy(),
  ],
)

// Timeline rows, data not text
export const issueEvents = pgTable(
  "issue_events",
  {
    id: primaryId(),
    orgId: orgRef(),
    issueId: uuid("issue_id").notNull(),
    action: text("action").$type<IssueEventAction>().notNull(),
    // State after the event
    advocacyStatus: text("advocacy_status").$type<AdvocacyStatus>().notNull(),
    govStatus: text("gov_status").$type<GovernmentStatus>().notNull(),
    referralId: uuid("referral_id"),
    responseId: uuid("response_id"),
    // Claim, confirm, reopen rows
    claimId: uuid("claim_id"),
    // Public reason, redactable
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("issue_events_issue_idx").on(t.orgId, t.issueId, t.occurredAt),
    index("issue_events_referral_idx")
      .on(t.orgId, t.referralId)
      .where(sql`${t.referralId} IS NOT NULL`),
    index("issue_events_response_idx")
      .on(t.orgId, t.responseId)
      .where(sql`${t.responseId} IS NOT NULL`),
    index("issue_events_claim_idx")
      .on(t.orgId, t.claimId)
      .where(sql`${t.claimId} IS NOT NULL`),
    issueRef("issue_events_issue_fk", t),
    foreignKey({
      name: "issue_events_referral_fk",
      columns: [t.orgId, t.referralId],
      foreignColumns: [referrals.orgId, referrals.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "issue_events_response_fk",
      columns: [t.orgId, t.responseId],
      foreignColumns: [responses.orgId, responses.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "issue_events_claim_fk",
      columns: [t.orgId, t.claimId],
      foreignColumns: [resolutionClaims.orgId, resolutionClaims.id],
    }).onDelete("cascade"),
    check("issue_events_action_check", oneOf(t.action, ISSUE_EVENT_ACTIONS)),
    check(
      "issue_events_advocacy_check",
      oneOf(t.advocacyStatus, ADVOCACY_STATUSES),
    ),
    check("issue_events_gov_check", oneOf(t.govStatus, GOVERNMENT_STATUSES)),
    tenantPolicy(),
  ],
)
