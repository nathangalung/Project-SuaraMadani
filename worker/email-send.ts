import { and, desc, eq, gte, sql } from "drizzle-orm"
import type { JobPayloads } from "../db/jobs.server.ts"
import { sendJob } from "../db/jobs.server.ts"
import { listOverdueReferrals } from "../db/referrals.server.ts"
import { type MemberRole, members, users } from "../db/schema/auth.ts"
import { fixSurveys } from "../db/schema/claims.ts"
import { demandFollows, demandItems, demands } from "../db/schema/demands.ts"
import { issueReports, issues, resolutionClaims } from "../db/schema/issues.ts"
import {
  contentComplaints,
  moderationDecisions,
} from "../db/schema/moderation.ts"
import {
  emailLog,
  follows,
  type NotificationStatus,
  notifications,
} from "../db/schema/notifications.ts"
import { organizations } from "../db/schema/organizations.ts"
import { agencyReplies } from "../db/schema/replies.ts"
import { reports } from "../db/schema/reports.ts"
import { type Tx, withTenant } from "../db/tenant.server.ts"
import {
  createEmailSender,
  EmailSendError,
  type EmailSender,
  neverSent,
} from "../server/email.ts"
import {
  addressHash,
  EMAIL_QUOTA_LOCK,
  hashKey,
  usedToday,
} from "../server/email-log.ts"
import { brandColor } from "../server/emails/layout.ts"
import {
  isFollowerTemplate,
  isReportTemplate,
  type MailSite,
  type RenderedMail,
  renderComplaintMail,
  renderDeadlineMail,
  renderDemandMail,
  renderFollowerMail,
  renderReplyMail,
  renderReporterMail,
  renderSurveyMail,
} from "../server/emails/render.ts"
import { writeLog } from "../server/log.ts"
import { originFor } from "../server/origin.server.ts"
import {
  type Keyring,
  type LinkPurpose,
  linkExpiry,
  linkKeyring,
  signLink,
} from "../server/signed-link.ts"
import { appealDeadline } from "../shared/complaints.ts"
import { jakartaIsoDate } from "../shared/format.ts"
import { isDecisionReason, referralWait } from "../shared/moderation.ts"
import {
  type ComplaintTemplate,
  DEADLINE_TEMPLATE,
  type DemandTemplate,
  EMAIL_QUOTA,
  isComplaintTemplate,
  isDemandTemplate,
  isReplyTemplate,
  isUndeliverable,
  jakartaDayStart,
  type NotificationTemplate,
  nextSendMorning,
  type ReplyTemplate,
  SURVEY_TEMPLATE,
} from "../shared/notifications.ts"
import { demandProgress } from "../shared/status.ts"

export type EmailSendDeps = {
  email: EmailSender
  keyring: () => Keyring
  hashKey: () => Buffer
  now: () => Date
  originFor: (host: string) => string
}

export type EmailSendOutcome =
  | "sent"
  | "done"
  | "busy"
  | "skipped"
  | "deferred"
  | "failed"

type Data = JobPayloads["email-send"]

// Beyond the job expiry
const STALE_SENDING_MS = 70_000
// Starting Values: 429 deferrals
const MAX_RATE_DEFERRALS = 24
const DEFAULT_RETRY_AFTER_S = 60
const FINAL: NotificationStatus[] = ["sent", "failed", "skipped"]
const DAY_MS = 86_400_000

// Mail not sent, row skipped
type Skip =
  | "unfollowed"
  | "unpublished"
  | "not_admin"
  | "superseded"
  | "resolved"
  | "claim_closed"
  | "answered"

/** Missing keys fail at boot. */
function defaultEmailSendDeps(): EmailSendDeps {
  linkKeyring()
  hashKey()
  return {
    email: createEmailSender(),
    keyring: linkKeyring,
    hashKey,
    now: () => new Date(),
    originFor,
  }
}

type Claim =
  | { kind: "done" | "busy" | "skipped" | "deferred" }
  | { kind: "claimed"; logId: string; to: string; mail: RenderedMail }

async function skip(tx: Tx, id: string, reason: string): Promise<Claim> {
  await tx
    .update(notifications)
    .set({ status: "skipped", error: reason })
    .where(eq(notifications.id, id))
  return { kind: "skipped" }
}

/** Rows read under the tenant. */
async function compose(
  tx: Tx,
  deps: EmailSendDeps,
  input: {
    orgId: string
    userId: string
    template: NotificationTemplate
    reportId: string | null
    issueId: string | null
    complaintId: string | null
    demandId: string | null
    replyId: string | null
    claimId: string | null
    role: MemberRole | null
    createdAt: Date
  },
): Promise<RenderedMail | Skip> {
  const [org] = await tx
    .select({
      name: organizations.name,
      campusName: organizations.campusName,
      host: organizations.host,
      theme: organizations.theme,
    })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
  if (!org) throw new Error("organization not found")
  const origin = deps.originFor(org.host)
  const site: MailSite = {
    name: `Sadar Bersuara · ${org.name}`,
    origin,
    brand: brandColor(org.theme.brand),
  }
  const now = deps.now()
  const sign = (purpose: LinkPurpose, subjectId: string) =>
    signLink(deps.keyring(), {
      purpose,
      orgId: input.orgId,
      subjectId,
      userId: input.userId,
      expiresAt: linkExpiry(now),
    })

  const { template } = input
  if (template === DEADLINE_TEMPLATE) {
    return composeDeadline(tx, {
      site,
      operator: org.name,
      userId: input.userId,
      role: input.role,
      createdAt: input.createdAt,
      now,
    })
  }
  if (template === SURVEY_TEMPLATE && input.issueId && input.claimId) {
    return composeSurvey(tx, {
      site,
      issueId: input.issueId,
      claimId: input.claimId,
      userId: input.userId,
      sign: (claimId) => sign("survei", claimId),
    })
  }
  if (input.replyId && isReplyTemplate(template)) {
    return composeReply(tx, { site, template, replyId: input.replyId })
  }
  if (input.complaintId && isComplaintTemplate(template)) {
    return composeComplaint(tx, {
      site,
      template,
      complaintId: input.complaintId,
    })
  }
  if (input.reportId && isReportTemplate(template)) {
    const [report] = await tx
      .select({
        code: reports.publicCode,
        title: reports.title,
        forwardedFrom: reports.forwardedFromCode,
        issueCode: issues.publicCode,
        issueTitle: issues.title,
        publishedAt: issues.publishedAt,
        takenDownAt: issues.takenDownAt,
      })
      .from(reports)
      .leftJoin(
        issueReports,
        and(
          eq(issueReports.orgId, reports.orgId),
          eq(issueReports.reportId, reports.id),
        ),
      )
      .leftJoin(
        issues,
        and(
          eq(issues.orgId, issueReports.orgId),
          eq(issues.id, issueReports.issueId),
        ),
      )
      .where(eq(reports.id, input.reportId))
    if (!report) throw new Error("notified report not found")
    // Removed issue: code only
    const removed = report.takenDownAt !== null
    const issue =
      template === "report_merged" && report.issueCode
        ? {
            code: report.issueCode,
            title: removed ? null : (report.issueTitle ?? ""),
            url: report.publishedAt
              ? `${origin}/isu/${report.issueCode}`
              : null,
            removed,
          }
        : null
    const decided =
      template === "report_rejected" || template === "report_unverifiable"
    const [decision] = decided
      ? await tx
          .select({
            reason: moderationDecisions.reasonCode,
            text: moderationDecisions.reasonText,
          })
          .from(moderationDecisions)
          .where(eq(moderationDecisions.reportId, input.reportId))
          .orderBy(desc(moderationDecisions.decidedAt))
          .limit(1)
      : []
    return renderReporterMail({
      template,
      site,
      report: { code: report.code, title: report.title },
      issue,
      trackUrl: `${origin}/lacak?t=${sign("lacak", input.reportId)}`,
      decision:
        decision?.text && isDecisionReason(decision.reason)
          ? { reason: decision.reason, text: decision.text }
          : null,
      forwarded:
        template === "report_forwarded"
          ? {
              from: report.forwardedFrom ?? report.code,
              campus: org.campusName,
            }
          : null,
    })
  }

  if (input.demandId && isDemandTemplate(template)) {
    return composeDemand(tx, {
      site,
      template,
      demandId: input.demandId,
      userId: input.userId,
      unsubscribe: (code) =>
        `${origin}/tuntutan/${code}/berhenti?t=${sign("berhenti-tuntutan", input.demandId ?? "")}`,
    })
  }

  const issueId = input.issueId
  if (!issueId || !isFollowerTemplate(template)) {
    throw new Error(`template ${template} does not fit its row`)
  }
  const [issue] = await tx
    .select({
      code: issues.publicCode,
      title: issues.title,
      govStatus: issues.govStatus,
      advocacyStatus: issues.advocacyStatus,
      publishedAt: issues.publishedAt,
      following: follows.userId,
    })
    .from(issues)
    .leftJoin(
      follows,
      and(
        eq(follows.orgId, issues.orgId),
        eq(follows.issueId, issues.id),
        eq(follows.userId, input.userId),
      ),
    )
    .where(eq(issues.id, issueId))
  if (!issue) throw new Error("notified issue not found")
  if (!issue.following) return "unfollowed"
  // Hidden or removed since fan-out
  if (!issue.publishedAt) return "unpublished"
  return renderFollowerMail({
    template,
    site,
    issue: {
      code: issue.code,
      title: issue.title,
      url: `${origin}/isu/${issue.code}`,
      govStatus: issue.govStatus,
      advocacyStatus: issue.advocacyStatus,
    },
    unsubscribeUrl: `${origin}/isu/${issue.code}/berhenti?t=${sign("berhenti", issueId)}`,
  })
}

/** Live list at send time. */
async function composeDeadline(
  tx: Tx,
  input: {
    site: MailSite
    operator: string
    userId: string
    role: MemberRole | null
    createdAt: Date
    now: Date
  },
): Promise<RenderedMail | Skip> {
  // Staff only, role may change
  if (input.role !== "admin") return "not_admin"
  // Next digest covers this
  const nextDay = new Date(jakartaDayStart(input.createdAt).getTime() + DAY_MS)
  const [newer] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.template, DEADLINE_TEMPLATE),
        gte(notifications.createdAt, nextDay),
      ),
    )
    .limit(1)
  if (newer) return "superseded"
  const rows = await listOverdueReferrals(tx, jakartaIsoDate(input.now))
  if (rows.length === 0) return "resolved"
  return renderDeadlineMail({
    site: input.site,
    operator: input.operator,
    items: rows.map((row) => ({
      code: row.code,
      title: row.title,
      agency: row.agency,
      deadlineOn: row.deadlineOn,
      days: referralWait(row, "awaiting_response", input.now)?.days ?? 0,
    })),
  })
}

async function composeDemand(
  tx: Tx,
  input: {
    site: MailSite
    template: DemandTemplate
    demandId: string
    userId: string
    unsubscribe: (code: string) => string
  },
): Promise<RenderedMail | "unfollowed" | "unpublished"> {
  const [demand] = await tx
    .select({
      code: demands.publicCode,
      title: demands.title,
      state: demands.state,
      following: demandFollows.userId,
    })
    .from(demands)
    .leftJoin(
      demandFollows,
      and(
        eq(demandFollows.orgId, demands.orgId),
        eq(demandFollows.demandId, demands.id),
        eq(demandFollows.userId, input.userId),
      ),
    )
    .where(eq(demands.id, input.demandId))
  if (!demand) throw new Error("notified demand not found")
  if (!demand.following) return "unfollowed"
  // Hidden since fan-out
  if (demand.state === "draft") return "unpublished"
  const items = await tx
    .select({
      response: demandItems.responseStatus,
      fulfilment: demandItems.fulfilmentStatus,
    })
    .from(demandItems)
    .where(eq(demandItems.demandId, input.demandId))
  return renderDemandMail({
    template: input.template,
    site: input.site,
    demand: {
      code: demand.code,
      title: demand.title,
      url: `${input.site.origin}/tuntutan/${demand.code}`,
      progress: demandProgress(items),
    },
    unsubscribeUrl: input.unsubscribe(demand.code),
  })
}

/** Its own round, open, unanswered. */
async function composeSurvey(
  tx: Tx,
  input: {
    site: MailSite
    issueId: string
    claimId: string
    userId: string
    sign: (claimId: string) => string
  },
): Promise<RenderedMail | Skip> {
  const [row] = await tx
    .select({
      code: issues.publicCode,
      title: issues.title,
      publishedAt: issues.publishedAt,
      claimId: resolutionClaims.id,
      claimedAt: resolutionClaims.claimedAt,
      closedAt: resolutionClaims.closedAt,
      answer: fixSurveys.answer,
    })
    .from(issues)
    .leftJoin(
      resolutionClaims,
      and(
        eq(resolutionClaims.orgId, issues.orgId),
        eq(resolutionClaims.issueId, issues.id),
        eq(resolutionClaims.id, input.claimId),
      ),
    )
    .leftJoin(
      fixSurveys,
      and(
        eq(fixSurveys.orgId, resolutionClaims.orgId),
        eq(fixSurveys.claimId, resolutionClaims.id),
        eq(fixSurveys.userId, input.userId),
      ),
    )
    .where(eq(issues.id, input.issueId))
  if (!row) throw new Error("surveyed issue not found")
  if (!row.publishedAt) return "unpublished"
  if (!row.claimId || !row.claimedAt || row.closedAt) return "claim_closed"
  if (row.answer) return "answered"
  const url = `${input.site.origin}/isu/${row.code}`
  return renderSurveyMail({
    site: input.site,
    issue: { code: row.code, title: row.title, url },
    surveyUrl: `${url}/survei?t=${input.sign(row.claimId)}`,
    claimedAt: row.claimedAt,
  })
}

async function composeReply(
  tx: Tx,
  input: { site: MailSite; template: ReplyTemplate; replyId: string },
): Promise<RenderedMail> {
  const [row] = await tx
    .select({
      agency: agencyReplies.agency,
      status: agencyReplies.status,
      reason: agencyReplies.rejectReason,
      code: issues.publicCode,
      title: issues.title,
    })
    .from(agencyReplies)
    .innerJoin(
      issues,
      and(
        eq(issues.orgId, agencyReplies.orgId),
        eq(issues.id, agencyReplies.issueId),
      ),
    )
    .where(eq(agencyReplies.id, input.replyId))
  if (!row) throw new Error("notified reply not found")
  const decision =
    input.template === "reply_received"
      ? null
      : row.status === "accepted"
        ? ({ status: "accepted" } as const)
        : row.status === "rejected" && row.reason
          ? ({ status: "rejected", reason: row.reason } as const)
          : null
  if (input.template === "reply_decided" && !decision) {
    throw new Error("reply decision missing")
  }
  return renderReplyMail({
    site: input.site,
    issue: {
      code: row.code,
      title: row.title,
      url: `${input.site.origin}/isu/${row.code}`,
    },
    agency: row.agency,
    decision,
  })
}

async function composeComplaint(
  tx: Tx,
  input: { site: MailSite; template: ComplaintTemplate; complaintId: string },
): Promise<RenderedMail> {
  const c = contentComplaints
  const [row] = await tx
    .select({
      code: c.publicCode,
      issueCode: issues.publicCode,
      demandCode: demands.publicCode,
      decision: c.decision,
      reason: c.decisionReason,
      text: c.decisionText,
      decidedAt: c.decidedAt,
      appealDecision: c.appealDecision,
      appealReason: c.appealReason,
      appealText: c.appealDecisionText,
    })
    .from(c)
    .leftJoin(issues, and(eq(issues.orgId, c.orgId), eq(issues.id, c.issueId)))
    .leftJoin(
      demands,
      and(eq(demands.orgId, c.orgId), eq(demands.id, c.demandId)),
    )
    .where(eq(c.id, input.complaintId))
  if (!row) throw new Error("notified complaint not found")
  const appeal = input.template === "complaint_appeal_decided"
  const picked = appeal
    ? {
        decision: row.appealDecision,
        reason: row.appealReason,
        text: row.appealText,
      }
    : { decision: row.decision, reason: row.reason, text: row.text }
  const decision =
    input.template !== "complaint_received" &&
    picked.decision &&
    picked.reason &&
    picked.text
      ? { decision: picked.decision, reason: picked.reason, text: picked.text }
      : null
  return renderComplaintMail({
    template: input.template,
    site: input.site,
    complaint: {
      code: row.code,
      subject: row.demandCode
        ? { kind: "demand", code: row.demandCode }
        : { kind: "issue", code: row.issueCode ?? "" },
      url: `${input.site.origin}/aduan/${row.code}`,
    },
    decision,
    appealUntil:
      input.template === "complaint_decided" && row.decidedAt
        ? appealDeadline(row.decidedAt)
        : null,
  })
}

/** Quota slot plus row claim. */
async function claim(tx: Tx, deps: EmailSendDeps, data: Data): Promise<Claim> {
  await tx.execute(sql`select pg_advisory_xact_lock(${EMAIL_QUOTA_LOCK})`)
  const now = deps.now()
  const [row] = await tx
    .select({
      id: notifications.id,
      status: notifications.status,
      claimedAt: notifications.claimedAt,
      userId: notifications.userId,
      template: notifications.template,
      reportId: notifications.reportId,
      issueId: notifications.issueId,
      complaintId: notifications.complaintId,
      demandId: notifications.demandId,
      replyId: notifications.replyId,
      claimId: notifications.claimId,
      createdAt: notifications.createdAt,
      logId: emailLog.id,
      logStatus: emailLog.status,
      logAt: emailLog.createdAt,
      email: users.email,
      emailVerified: users.emailVerified,
      member: members.id,
      role: members.role,
    })
    .from(notifications)
    .leftJoin(emailLog, eq(emailLog.id, notifications.emailLogId))
    .leftJoin(users, eq(users.id, notifications.userId))
    .leftJoin(
      members,
      and(
        eq(members.organizationId, notifications.orgId),
        eq(members.userId, notifications.userId),
      ),
    )
    .where(eq(notifications.id, data.notificationId))
  // Deleted, or wrong org
  if (!row) {
    writeLog({ msg: "notification row gone", queue: "email-send" })
    return { kind: "skipped" }
  }
  if (FINAL.includes(row.status)) return { kind: "done" }
  if (
    row.status === "sending" &&
    row.claimedAt &&
    now.getTime() - row.claimedAt.getTime() < STALE_SENDING_MS
  ) {
    return { kind: "busy" }
  }
  if (!row.userId || !row.email || !row.member) {
    return skip(tx, row.id, "closed")
  }
  if (isUndeliverable(row.email)) return skip(tx, row.id, "undeliverable")
  // Never mail an unproven address
  if (!row.emailVerified) return skip(tx, row.id, "unverified")
  const mail = await compose(tx, deps, {
    orgId: data.orgId,
    userId: row.userId,
    template: row.template,
    reportId: row.reportId,
    issueId: row.issueId,
    complaintId: row.complaintId,
    demandId: row.demandId,
    replyId: row.replyId,
    claimId: row.claimId,
    role: row.role,
    createdAt: row.createdAt,
  })
  if (typeof mail === "string") return skip(tx, row.id, mail)

  // Earlier timeout today: reuse
  if (
    row.logId &&
    row.logStatus === "reserved" &&
    row.logAt &&
    row.logAt >= jakartaDayStart(now)
  ) {
    await tx
      .update(notifications)
      .set({ status: "sending", claimedAt: now })
      .where(eq(notifications.id, row.id))
    return { kind: "claimed", logId: row.logId, to: row.email, mail }
  }
  // Invitations share the ceiling
  const shared = await usedToday(tx, now, ["notification", "invitation"])
  // OTP may fill the day
  const total = await usedToday(tx, now)
  if (
    shared >= EMAIL_QUOTA.notificationCeiling ||
    total >= EMAIL_QUOTA.providerDaily
  ) {
    // Item 4: next morning
    await tx
      .update(notifications)
      .set({ status: "pending", claimedAt: null })
      .where(eq(notifications.id, row.id))
    await sendJob(tx, "email-send", data, { startAfter: nextSendMorning(now) })
    return { kind: "deferred" }
  }
  const [log] = await tx
    .insert(emailLog)
    .values({
      kind: "notification",
      addressHash: addressHash(row.email, deps.hashKey()),
      status: "reserved",
      createdAt: now,
    })
    .returning({ id: emailLog.id })
  if (!log) throw new Error("email_log not inserted")
  await tx
    .update(notifications)
    .set({ status: "sending", claimedAt: now, emailLogId: log.id })
    .where(eq(notifications.id, row.id))
  return { kind: "claimed", logId: log.id, to: row.email, mail }
}

type Settle = {
  status: NotificationStatus
  log: "sent" | "failed" | null
  error?: string
}

async function settle(
  tx: Tx,
  ids: { notificationId: string; logId: string },
  outcome: Settle,
  now: Date,
): Promise<void> {
  const done = outcome.status === "sent"
  await tx
    .update(notifications)
    .set({
      status: outcome.status,
      error: outcome.error ?? null,
      sentAt: done ? now : null,
      claimedAt: outcome.status === "pending" ? null : undefined,
    })
    .where(eq(notifications.id, ids.notificationId))
  if (outcome.log) {
    await tx
      .update(emailLog)
      .set({ status: outcome.log, sentAt: done ? now : null })
      .where(eq(emailLog.id, ids.logId))
  }
}

/** One email per row. */
export function createEmailSendHandler(
  deps: EmailSendDeps = defaultEmailSendDeps(),
) {
  return async (data: Data): Promise<EmailSendOutcome> => {
    const claimed = await withTenant(data.orgId, (tx) => claim(tx, deps, data))
    if (claimed.kind !== "claimed") return claimed.kind
    const ids = { notificationId: data.notificationId, logId: claimed.logId }
    const finish = (outcome: Settle) =>
      withTenant(data.orgId, (tx) => settle(tx, ids, outcome, deps.now()))
    try {
      await deps.email.send({
        to: claimed.to,
        ...claimed.mail,
        idempotencyKey: data.notificationId,
      })
    } catch (error) {
      if (!(error instanceof EmailSendError)) {
        // Timeout: unknown, slot kept, reused
        await finish({
          status: "pending",
          log: neverSent(error) ? "failed" : null,
        })
        throw error
      }
      if (error.permanent) {
        await finish({
          status: "failed",
          log: "failed",
          error: `http_${error.status}`,
        })
        return "failed"
      }
      await finish({ status: "pending", log: "failed" })
      const deferrals = data.deferrals ?? 0
      if (!error.rateLimited || deferrals >= MAX_RATE_DEFERRALS) throw error
      const wait = (error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_S) * 1000
      await withTenant(data.orgId, (tx) =>
        sendJob(
          tx,
          "email-send",
          { ...data, deferrals: deferrals + 1 },
          { startAfter: new Date(deps.now().getTime() + wait) },
        ),
      )
      return "deferred"
    }
    await finish({ status: "sent", log: "sent" })
    return "sent"
  }
}
