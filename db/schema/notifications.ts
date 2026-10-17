import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import {
  NOTIFICATION_TEMPLATES,
  type NotificationTemplate,
} from "../../shared/notifications.ts"
import { OTP_PURPOSES, type OtpPurpose } from "../../shared/whatsapp.ts"
import { users } from "./auth.ts"
import { createdAt, oneOf, primaryId, tenantPolicy } from "./columns.ts"
import { demands } from "./demands.ts"
import { issues } from "./issues.ts"
import { contentComplaints } from "./moderation.ts"
import { organizations } from "./organizations.ts"
import { reports } from "./reports.ts"

const at = (name: string) => timestamp(name, { withTimezone: true })

export const follows = pgTable(
  "follows",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    issueId: uuid("issue_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    // Fan-out pages by user_id
    primaryKey({ columns: [t.orgId, t.issueId, t.userId] }),
    index("follows_user_idx").on(t.userId),
    foreignKey({
      name: "follows_issue_fk",
      columns: [t.orgId, t.issueId],
      foreignColumns: [issues.orgId, issues.id],
    }).onDelete("cascade"),
    tenantPolicy(),
  ],
)

export const NOTIFICATION_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
] as const
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

// One email per row
export const notifications = pgTable(
  "notifications",
  {
    id: primaryId(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    // Null after account deletion
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // The audit_log row behind it
    eventId: uuid("event_id").notNull(),
    template: text("template").$type<NotificationTemplate>().notNull(),
    reportId: uuid("report_id"),
    issueId: uuid("issue_id"),
    complaintId: uuid("complaint_id"),
    demandId: uuid("demand_id"),
    status: text("status")
      .$type<NotificationStatus>()
      .notNull()
      .default("pending"),
    // Provider error code, never text
    error: text("error"),
    claimedAt: at("claimed_at"),
    sentAt: at("sent_at"),
    // One quota slot across retries
    emailLogId: uuid("email_log_id").references(() => emailLog.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("notifications_event_user_key").on(t.orgId, t.eventId, t.userId),
    index("notifications_status_idx").on(t.orgId, t.status, t.createdAt),
    // Cascade lookups, decisions.md
    index("notifications_report_idx")
      .on(t.orgId, t.reportId)
      .where(sql`${t.reportId} IS NOT NULL`),
    index("notifications_issue_idx")
      .on(t.orgId, t.issueId)
      .where(sql`${t.issueId} IS NOT NULL`),
    index("notifications_complaint_idx")
      .on(t.orgId, t.complaintId)
      .where(sql`${t.complaintId} IS NOT NULL`),
    index("notifications_demand_idx")
      .on(t.orgId, t.demandId)
      .where(sql`${t.demandId} IS NOT NULL`),
    index("notifications_user_idx")
      .on(t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    index("notifications_email_log_idx")
      .on(t.emailLogId)
      .where(sql`${t.emailLogId} IS NOT NULL`),
    foreignKey({
      name: "notifications_report_fk",
      columns: [t.orgId, t.reportId],
      foreignColumns: [reports.orgId, reports.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_issue_fk",
      columns: [t.orgId, t.issueId],
      foreignColumns: [issues.orgId, issues.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_complaint_fk",
      columns: [t.orgId, t.complaintId],
      foreignColumns: [contentComplaints.orgId, contentComplaints.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_demand_fk",
      columns: [t.orgId, t.demandId],
      foreignColumns: [demands.orgId, demands.id],
    }).onDelete("cascade"),
    check(
      "notifications_template_check",
      oneOf(t.template, NOTIFICATION_TEMPLATES),
    ),
    check("notifications_status_check", oneOf(t.status, NOTIFICATION_STATUSES)),
    check(
      "notifications_subject_check",
      sql`num_nonnulls(${t.reportId}, ${t.issueId}, ${t.complaintId}, ${t.demandId}) = 1`,
    ),
    tenantPolicy(),
  ],
)

export const EMAIL_KINDS = ["otp", "notification", "invitation"] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]
export const EMAIL_LOG_STATUSES = ["reserved", "sent", "failed"] as const
export type EmailLogStatus = (typeof EMAIL_LOG_STATUSES)[number]

// Outside RLS: counts every send
export const emailLog = pgTable(
  "email_log",
  {
    id: primaryId(),
    kind: text("kind").$type<EmailKind>().notNull(),
    // HMAC, never the address
    addressHash: text("address_hash").notNull(),
    status: text("status").$type<EmailLogStatus>().notNull(),
    // OTP only: unproven is sign_up
    purpose: text("purpose").$type<OtpPurpose>(),
    // HMAC, IPv4 or IPv6 /64
    clientHash: text("client_hash"),
    createdAt: createdAt(),
    sentAt: at("sent_at"),
  },
  (t) => [
    index("email_log_kind_created_idx").on(t.kind, t.createdAt),
    index("email_log_address_idx").on(t.addressHash, t.createdAt),
    check("email_log_kind_check", oneOf(t.kind, EMAIL_KINDS)),
    check("email_log_status_check", oneOf(t.status, EMAIL_LOG_STATUSES)),
    check("email_log_purpose_check", oneOf(t.purpose, OTP_PURPOSES)),
  ],
)
