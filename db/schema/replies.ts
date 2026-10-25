import { desc, sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import {
  REPLY_REJECT_REASONS,
  REPLY_STATUSES,
  type ReplyRejectReason,
  type ReplyStatus,
} from "../../shared/replies.ts"
import { users } from "./auth.ts"
import { createdAt, oneOf, primaryId, tenantPolicy } from "./columns.ts"
import { issues, responses } from "./issues.ts"
import { organizations } from "./organizations.ts"

// Right of reply, PLAN §5.5
export const agencyReplies = pgTable(
  "agency_replies",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    issueId: uuid("issue_id").notNull(),
    // Null after account deletion
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    submissionId: uuid("submission_id").notNull(),
    agency: text("agency").notNull(),
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    sourceUrl: text("source_url"),
    status: text("status").$type<ReplyStatus>().notNull().default("pending"),
    rejectReason: text("reject_reason").$type<ReplyRejectReason>(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // The published responses row
    responseId: uuid("response_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("agency_replies_org_id_id_key").on(t.orgId, t.id),
    unique("agency_replies_submission_key").on(t.userId, t.submissionId),
    index("agency_replies_queue_idx").on(t.orgId, t.status, desc(t.createdAt)),
    // Decided list, no Sort
    index("agency_replies_decided_idx").on(
      t.orgId,
      t.status,
      desc(t.decidedAt),
      t.id,
    ),
    index("agency_replies_issue_idx").on(t.orgId, t.issueId),
    index("agency_replies_user_idx")
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index("agency_replies_response_idx")
      .on(t.orgId, t.responseId)
      .where(sql`${t.responseId} IS NOT NULL`),
    foreignKey({
      name: "agency_replies_issue_fk",
      columns: [t.orgId, t.issueId],
      foreignColumns: [issues.orgId, issues.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agency_replies_response_fk",
      columns: [t.orgId, t.responseId],
      foreignColumns: [responses.orgId, responses.id],
    }),
    check("agency_replies_status_check", oneOf(t.status, REPLY_STATUSES)),
    check(
      "agency_replies_reason_check",
      sql`${t.rejectReason} IS NULL OR ${oneOf(t.rejectReason, REPLY_REJECT_REASONS)}`,
    ),
    check(
      "agency_replies_decision_check",
      sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL) AND (${t.status} = 'rejected') = (${t.rejectReason} IS NOT NULL) AND (${t.status} = 'accepted') = (${t.responseId} IS NOT NULL)`,
    ),
    check(
      "agency_replies_source_check",
      sql`${t.sourceUrl} IS NULL OR ${t.sourceUrl} ~ '^https?://'`,
    ),
    tenantPolicy(),
  ],
)
