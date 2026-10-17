import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import {
  COMPLAINT_DECISION_REASONS,
  COMPLAINT_DECISIONS,
  COMPLAINT_PARTS,
  COMPLAINT_REASONS,
  COMPLAINT_STATUSES,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  type ComplaintPart,
  type ComplaintReason,
  type ComplaintStatus,
  STANDARD_REASONS,
  type StandardReason,
} from "../../shared/complaints.ts"
import type { PublicFile } from "../../shared/evidence.ts"
import {
  type DecisionReason,
  PURGE_STATUSES,
  type PurgeStatus,
  REJECT_REASONS,
  TAKEDOWN_ACTIONS,
  type TakedownAction,
  UNVERIFIABLE_REASONS,
  VERIFY_METHODS,
  type VerifyMethod,
} from "../../shared/moderation.ts"
import { users } from "./auth.ts"
import {
  createdAt,
  oneOf,
  primaryId,
  tenantPolicy,
  updatedAt,
} from "./columns.ts"
import { demands } from "./demands.ts"
import { issues } from "./issues.ts"
import { organizations } from "./organizations.ts"
import { reports } from "./reports.ts"

export const DECISION_ACTIONS = [
  "verify",
  "mark_unverifiable",
  "reject",
] as const
export type DecisionAction = (typeof DECISION_ACTIONS)[number]

// Statement of reasons, PLAN §5.10
export const moderationDecisions = pgTable(
  "moderation_decisions",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    reportId: uuid("report_id").notNull(),
    action: text("action").$type<DecisionAction>().notNull(),
    reasonCode: text("reason_code")
      .$type<DecisionReason | VerifyMethod>()
      .notNull(),
    // Reporter guidance, redactable
    reasonText: text("reason_text"),
    // No FK: rows outlive users
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("moderation_decisions_report_idx").on(
      t.orgId,
      t.reportId,
      t.decidedAt,
    ),
    foreignKey({
      name: "moderation_decisions_report_fk",
      columns: [t.orgId, t.reportId],
      foreignColumns: [reports.orgId, reports.id],
    }).onDelete("cascade"),
    check(
      "moderation_decisions_action_check",
      oneOf(t.action, DECISION_ACTIONS),
    ),
    check(
      "moderation_decisions_reason_check",
      sql`(${t.action} = 'verify' AND ${oneOf(t.reasonCode, VERIFY_METHODS)} AND ${t.reasonText} IS NULL) OR (${t.action} = 'reject' AND ${oneOf(t.reasonCode, REJECT_REASONS)} AND ${t.reasonText} IS NOT NULL) OR (${t.action} = 'mark_unverifiable' AND ${oneOf(t.reasonCode, UNVERIFIABLE_REASONS)} AND ${t.reasonText} IS NOT NULL)`,
    ),
    tenantPolicy(),
  ],
)

const at = (name: string) => timestamp(name, { withTimezone: true })

const issueFk = (
  name: string,
  t: {
    orgId: Parameters<typeof foreignKey>[0]["columns"][number]
    issueId: Parameters<typeof foreignKey>[0]["columns"][number]
  },
) =>
  foreignKey({
    name,
    columns: [t.orgId, t.issueId],
    foreignColumns: [issues.orgId, issues.id],
  }).onDelete("cascade")

const DECIDED = sql.raw("'decided', 'appealed', 'appeal_decided'") // sql-raw-ok: constant

// DSA Art. 16 notices
export const contentComplaints = pgTable(
  "content_complaints",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    // Exactly one subject
    issueId: uuid("issue_id"),
    demandId: uuid("demand_id"),
    publicCode: text("public_code").notNull(),
    // Null after account deletion
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    submissionId: uuid("submission_id").notNull(),
    reason: text("reason").$type<ComplaintReason>().notNull(),
    part: text("part").$type<ComplaintPart>().notNull(),
    explanation: text("explanation").notNull(),
    status: text("status").$type<ComplaintStatus>().notNull().default("open"),
    decision: text("decision").$type<ComplaintDecision>(),
    decisionReason: text("decision_reason").$type<ComplaintDecisionReason>(),
    // Statement of reasons, redactable
    decisionText: text("decision_text"),
    decidedBy: uuid("decided_by"),
    decidedAt: at("decided_at"),
    appealText: text("appeal_text"),
    appealedAt: at("appealed_at"),
    appealDecision: text("appeal_decision").$type<ComplaintDecision>(),
    appealReason: text("appeal_reason").$type<ComplaintDecisionReason>(),
    appealDecisionText: text("appeal_decision_text"),
    appealDecidedBy: uuid("appeal_decided_by"),
    appealDecidedAt: at("appeal_decided_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("content_complaints_org_id_id_key").on(t.orgId, t.id),
    unique("content_complaints_public_code_key").on(t.orgId, t.publicCode),
    unique("content_complaints_submission_key").on(
      t.orgId,
      t.userId,
      t.submissionId,
    ),
    index("content_complaints_queue_idx").on(t.orgId, t.status, t.createdAt),
    index("content_complaints_issue_idx").on(t.orgId, t.issueId),
    index("content_complaints_demand_idx")
      .on(t.orgId, t.demandId)
      .where(sql`${t.demandId} IS NOT NULL`),
    index("content_complaints_user_idx").on(t.userId, t.createdAt),
    issueFk("content_complaints_issue_fk", t),
    foreignKey({
      name: "content_complaints_demand_fk",
      columns: [t.orgId, t.demandId],
      foreignColumns: [demands.orgId, demands.id],
    }).onDelete("cascade"),
    check(
      "content_complaints_subject_check",
      sql`num_nonnulls(${t.issueId}, ${t.demandId}) = 1`,
    ),
    check(
      "content_complaints_reason_check",
      oneOf(t.reason, COMPLAINT_REASONS),
    ),
    check("content_complaints_part_check", oneOf(t.part, COMPLAINT_PARTS)),
    check(
      "content_complaints_status_check",
      oneOf(t.status, COMPLAINT_STATUSES),
    ),
    check(
      "content_complaints_decision_check",
      sql`(${t.decision} IS NULL OR ${oneOf(t.decision, COMPLAINT_DECISIONS)}) AND (${t.appealDecision} IS NULL OR ${oneOf(t.appealDecision, COMPLAINT_DECISIONS)}) AND (${t.decisionReason} IS NULL OR ${oneOf(t.decisionReason, COMPLAINT_DECISION_REASONS)}) AND (${t.appealReason} IS NULL OR ${oneOf(t.appealReason, COMPLAINT_DECISION_REASONS)})`,
    ),
    check(
      "content_complaints_decided_check",
      sql`(${t.status} IN (${DECIDED})) = (${t.decision} IS NOT NULL AND ${t.decisionReason} IS NOT NULL AND ${t.decisionText} IS NOT NULL AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check(
      "content_complaints_appealed_check",
      sql`(${t.status} IN ('appealed', 'appeal_decided')) = (${t.appealText} IS NOT NULL AND ${t.appealedAt} IS NOT NULL)`,
    ),
    check(
      "content_complaints_appeal_decided_check",
      sql`(${t.status} = 'appeal_decided') = (${t.appealDecision} IS NOT NULL AND ${t.appealReason} IS NOT NULL AND ${t.appealDecisionText} IS NOT NULL AND ${t.appealDecidedBy} IS NOT NULL AND ${t.appealDecidedAt} IS NOT NULL)`,
    ),
    // PLAN §5.10: another admin
    check(
      "content_complaints_appeal_moderator_check",
      sql`${t.appealDecidedBy} IS NULL OR ${t.appealDecidedBy} <> ${t.decidedBy}`,
    ),
    tenantPolicy(),
  ],
)

// Durable purge, ADR takedown flow
export const takedowns = pgTable(
  "takedowns",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    action: text("action").$type<TakedownAction>().notNull(),
    // Kept for audit after removal
    issueId: uuid("issue_id"),
    complaintId: uuid("complaint_id"),
    // Captured before rows change
    publicFiles: jsonb("public_files")
      .$type<PublicFile[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Private files, data-subject removal
    evidenceIds: uuid("evidence_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    purgeStatus: text("purge_status")
      .$type<PurgeStatus>()
      .notNull()
      .default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    // Error class, never text
    lastError: text("last_error"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    doneAt: at("done_at"),
  },
  (t) => [
    index("takedowns_status_idx").on(t.orgId, t.purgeStatus, t.createdAt),
    index("takedowns_complaint_idx").on(t.orgId, t.complaintId),
    check("takedowns_action_check", oneOf(t.action, TAKEDOWN_ACTIONS)),
    check("takedowns_status_check", oneOf(t.purgeStatus, PURGE_STATUSES)),
    check(
      "takedowns_done_check",
      sql`(${t.purgeStatus} = 'done') = (${t.doneAt} IS NOT NULL)`,
    ),
    tenantPolicy(),
  ],
)

export const REDACTED_COLUMNS = ["title", "summary"] as const
export type RedactedColumn = (typeof REDACTED_COLUMNS)[number]

// Admins only, PLAN §5.10
export const redactionOriginals = pgTable(
  "redaction_originals",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    issueId: uuid("issue_id").notNull(),
    column: text("column").$type<RedactedColumn>().notNull(),
    original: text("original").notNull(),
    reasonCode: text("reason_code").$type<StandardReason>().notNull(),
    complaintId: uuid("complaint_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("redaction_originals_issue_idx").on(t.orgId, t.issueId, t.createdAt),
    issueFk("redaction_originals_issue_fk", t),
    check(
      "redaction_originals_column_check",
      oneOf(t.column, REDACTED_COLUMNS),
    ),
    check(
      "redaction_originals_reason_check",
      oneOf(t.reasonCode, STANDARD_REASONS),
    ),
    tenantPolicy(),
    pgPolicy("staff_only", {
      as: "restrictive",
      for: "all",
      using: sql`current_setting('app.member_role', true) = 'admin'`,
      withCheck: sql`current_setting('app.member_role', true) = 'admin'`,
    }),
  ],
)
