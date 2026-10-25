import { and, asc, eq, gte, lt } from "drizzle-orm"
import { type Db, database } from "../db/client.server.ts"
import { type JobPayloads, sendJobs } from "../db/jobs.server.ts"
import { listOverdueReferrals } from "../db/referrals.server.ts"
import { auditLog } from "../db/schema/audit.ts"
import { members } from "../db/schema/auth.ts"
import { notifications } from "../db/schema/notifications.ts"
import { organizations } from "../db/schema/organizations.ts"
import { type Tx, withTenant } from "../db/tenant.server.ts"
import { errorRecord, writeLog } from "../server/log.ts"
import { jakartaIsoDate } from "../shared/format.ts"
import {
  DEADLINE_TEMPLATE,
  jakartaDayStart,
  quietUntil,
} from "../shared/notifications.ts"

// Raw code, label is frontend
const REMIND_ACTION = "referral.remind"
const DAY_MS = 86_400_000

export type DeadlineReminderDeps = { db?: Db; now?: () => Date }
export type DeadlineReminderResult = { orgs: number; digests: number }

/** Today's audit row, else new. */
async function dayEvent(tx: Tx, orgId: string, now: Date): Promise<string> {
  const start = jakartaDayStart(now)
  const [today] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, REMIND_ACTION),
        gte(auditLog.createdAt, start),
        lt(auditLog.createdAt, new Date(start.getTime() + DAY_MS)),
      ),
    )
    .orderBy(asc(auditLog.createdAt))
    .limit(1)
  if (today) return today.id
  const [row] = await tx
    .insert(auditLog)
    .values({
      orgId,
      action: REMIND_ACTION,
      entityType: "organization",
      entityId: orgId,
      createdAt: now,
    })
    .returning({ id: auditLog.id })
  if (!row) throw new Error("audit row not inserted")
  return row.id
}

/** One digest per admin, day. */
async function remindOrg(orgId: string, now: Date, db: Db): Promise<number> {
  return withTenant(
    orgId,
    async (tx) => {
      const overdue = await listOverdueReferrals(tx, jakartaIsoDate(now))
      if (overdue.length === 0) return 0
      const admins = await tx
        .select({ userId: members.userId })
        .from(members)
        .where(
          and(eq(members.organizationId, orgId), eq(members.role, "admin")),
        )
      if (admins.length === 0) {
        writeLog({ msg: "deadline reminder without admins", org_id: orgId })
        return 0
      }
      const eventId = await dayEvent(tx, orgId, now)
      // Rerun same day: conflicts
      const inserted = await tx
        .insert(notifications)
        .values(
          admins.map((admin) => ({
            orgId,
            userId: admin.userId,
            eventId,
            template: DEADLINE_TEMPLATE,
            createdAt: now,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: notifications.id })
      await sendJobs(
        tx,
        "email-send",
        inserted.map((row) => ({ orgId, notificationId: row.id })),
        { startAfter: quietUntil(now) },
      )
      return inserted.length
    },
    { db },
  )
}

/** Cron 07:00 WIB, every org. */
export function createDeadlineReminderHandler(deps: DeadlineReminderDeps = {}) {
  return async (
    _data: JobPayloads["deadline-reminders"],
  ): Promise<DeadlineReminderResult> => {
    const db = deps.db ?? database().db
    const now = deps.now?.() ?? new Date()
    const orgs = await db.select({ id: organizations.id }).from(organizations)
    let digests = 0
    let failed = 0
    for (const org of orgs) {
      try {
        digests += await remindOrg(org.id, now, db)
      } catch (error) {
        failed++
        writeLog({
          msg: "deadline reminder failed",
          org_id: org.id,
          ...errorRecord(error),
        })
      }
    }
    // Retry reruns only missing ones
    if (failed > 0)
      throw new Error(`deadline reminders failed in ${failed} orgs`)
    return { orgs: orgs.length, digests }
  }
}
