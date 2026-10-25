import { and, eq } from "drizzle-orm"
import type { NotificationTemplate } from "../shared/notifications.ts"
import { sendJob } from "./jobs.server.ts"
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
