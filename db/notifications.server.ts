import { and, eq } from "drizzle-orm"
import type {
  ComplaintTemplate,
  NotificationTemplate,
} from "../shared/notifications.ts"
import { sendJob } from "./jobs.server.ts"
import { contentComplaints } from "./schema/moderation.ts"
import { notifications } from "./schema/notifications.ts"
import { reports } from "./schema/reports.ts"
import type { Tx } from "./tenant.server.ts"

export type ReporterEvent = {
  orgId: string
  reportId: string
  // audit_log id of the change
  eventId: string
  template: NotificationTemplate
}

/** One row, one email-send job. */
export async function notifyReporter(
  tx: Tx,
  event: ReporterEvent,
): Promise<void> {
  const [report] = await tx
    .select({ userId: reports.userId })
    .from(reports)
    .where(and(eq(reports.orgId, event.orgId), eq(reports.id, event.reportId)))
    .limit(1)
  if (!report) throw new Error("notified report not found")
  const [row] = await tx
    .insert(notifications)
    .values({
      orgId: event.orgId,
      userId: report.userId,
      eventId: event.eventId,
      template: event.template,
      reportId: event.reportId,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  if (row) {
    await sendJob(tx, "email-send", {
      orgId: event.orgId,
      notificationId: row.id,
    })
  }
}

export type IssueEvent = {
  orgId: string
  issueId: string
  eventId: string
  template: NotificationTemplate
}

/** Worker fans out per follower. */
export async function notifyFollowers(
  tx: Tx,
  event: IssueEvent,
): Promise<void> {
  await sendJob(tx, "issue-notify", event)
}

export type DemandEvent = {
  orgId: string
  demandId: string
  eventId: string
  template: NotificationTemplate
}

/** Worker fans out per follower. */
export async function notifyDemandFollowers(
  tx: Tx,
  event: DemandEvent,
): Promise<void> {
  await sendJob(tx, "demand-notify", event)
}

export type ComplainantEvent = {
  orgId: string
  complaintId: string
  // audit_log id of the change
  eventId: string
  template: ComplaintTemplate
}

/** One row, one email-send job. */
export async function notifyComplainant(
  tx: Tx,
  event: ComplainantEvent,
): Promise<void> {
  const [complaint] = await tx
    .select({ userId: contentComplaints.userId })
    .from(contentComplaints)
    .where(
      and(
        eq(contentComplaints.orgId, event.orgId),
        eq(contentComplaints.id, event.complaintId),
      ),
    )
    .limit(1)
  if (!complaint) throw new Error("notified complaint not found")
  // Deleted account, nobody to tell
  if (!complaint.userId) return
  const [row] = await tx
    .insert(notifications)
    .values({
      orgId: event.orgId,
      userId: complaint.userId,
      eventId: event.eventId,
      template: event.template,
      complaintId: event.complaintId,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  if (row) {
    await sendJob(tx, "email-send", {
      orgId: event.orgId,
      notificationId: row.id,
    })
  }
}
