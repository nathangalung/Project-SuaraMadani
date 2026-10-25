import { and, eq, isNull } from "drizzle-orm"
import { type Db, database } from "../db/client.server.ts"
import { type JobPayloads, sendJobs } from "../db/jobs.server.ts"
import { auditLog } from "../db/schema/audit.ts"
import { members, users } from "../db/schema/auth.ts"
import { fixSurveys } from "../db/schema/claims.ts"
import { issueReports, issues, resolutionClaims } from "../db/schema/issues.ts"
import { notifications } from "../db/schema/notifications.ts"
import { reports } from "../db/schema/reports.ts"
import { withTenant } from "../db/tenant.server.ts"
import {
  isUndeliverable,
  nextSendMorning,
  quietUntil,
  SURVEY_TEMPLATE,
} from "../shared/notifications.ts"

// Raw code, label is frontend
const SEND_ACTION = "claim.survey_send"
const NO_RECIPIENT = "no_recipient"

export type SurveySendDeps = { db?: Db; now?: () => Date; enabled?: boolean }
export type SurveySendResult = { surveys: number } | { skipped: string }

/** Off until survey page ships. */
export function surveyEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const flag = env.SURVEY_ENABLED ?? ""
  if (flag !== "" && flag !== "true" && flag !== "false") {
    throw new Error("SURVEY_ENABLED must be true or false")
  }
  return flag === "true"
}

/** Reporters of a still-open claim. */
export function createSurveySendHandler(deps: SurveySendDeps = {}) {
  // Bad value fails boot
  const enabled = deps.enabled ?? surveyEnabled(process.env)
  return async (
    data: JobPayloads["survey-send"],
  ): Promise<SurveySendResult> => {
    const db = deps.db ?? database().db
    const now = deps.now?.() ?? new Date()
    return withTenant(
      data.orgId,
      async (tx) => {
        const [claim] = await tx
          .select({
            issueId: resolutionClaims.issueId,
            closedAt: resolutionClaims.closedAt,
            sentAt: resolutionClaims.surveySentAt,
            gov: issues.govStatus,
            publishedAt: issues.publishedAt,
            takenDownAt: issues.takenDownAt,
          })
          .from(resolutionClaims)
          .innerJoin(
            issues,
            and(
              eq(issues.orgId, resolutionClaims.orgId),
              eq(issues.id, resolutionClaims.issueId),
            ),
          )
          .where(eq(resolutionClaims.id, data.claimId))
          // Retry races a reopen
          .for("update", { of: resolutionClaims })
        if (!claim) return { skipped: "gone" }
        if (claim.sentAt) return { skipped: "sent" }
        if (claim.closedAt || claim.gov !== "claimed_resolved") {
          return { skipped: "closed" }
        }
        if (claim.takenDownAt) return { skipped: "taken_down" }
        // Hidden may be republished
        const wait = !claim.publishedAt
          ? "hidden"
          : !enabled
            ? "disabled"
            : null
        if (wait) {
          // Kept, retried each morning
          await sendJobs(tx, "survey-send", [data], {
            startAfter: nextSendMorning(now),
          })
          return { skipped: wait }
        }
        await tx
          .update(resolutionClaims)
          .set({ surveySentAt: now })
          .where(
            and(
              eq(resolutionClaims.id, data.claimId),
              isNull(resolutionClaims.surveySentAt),
            ),
          )
        // Same reach rule as email-send
        const reporters = await tx
          .selectDistinct({ userId: users.id, email: users.email })
          .from(issueReports)
          .innerJoin(
            reports,
            and(
              eq(reports.orgId, issueReports.orgId),
              eq(reports.id, issueReports.reportId),
            ),
          )
          .innerJoin(users, eq(users.id, reports.userId))
          .innerJoin(
            members,
            and(
              eq(members.organizationId, reports.orgId),
              eq(members.userId, users.id),
            ),
          )
          .where(
            and(
              eq(issueReports.issueId, claim.issueId),
              eq(users.emailVerified, true),
            ),
          )
        const userIds = reporters
          .filter((row) => !isUndeliverable(row.email))
          .map((row) => row.userId)
        // Trail even when nobody reachable
        const [event] = await tx
          .insert(auditLog)
          .values({
            orgId: data.orgId,
            action: SEND_ACTION,
            entityType: "issue",
            entityId: claim.issueId,
            reasonCode: userIds.length === 0 ? NO_RECIPIENT : null,
            createdAt: now,
          })
          .returning({ id: auditLog.id })
        if (!event) throw new Error("audit row not inserted")
        if (userIds.length === 0) return { surveys: 0 }
        await tx
          .insert(fixSurveys)
          .values(
            userIds.map((userId) => ({
              orgId: data.orgId,
              claimId: data.claimId,
              userId,
              sentAt: now,
            })),
          )
          .onConflictDoNothing()
        const rows = await tx
          .insert(notifications)
          .values(
            userIds.map((userId) => ({
              orgId: data.orgId,
              userId,
              eventId: event.id,
              template: SURVEY_TEMPLATE,
              issueId: claim.issueId,
              claimId: data.claimId,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: notifications.id })
        const startAfter = quietUntil(now)
        await sendJobs(
          tx,
          "email-send",
          rows.map((row) => ({
            orgId: data.orgId,
            notificationId: row.id,
          })),
          startAfter ? { startAfter } : {},
        )
        return { surveys: rows.length }
      },
      { db },
    )
  }
}
