import { eq, sql } from "drizzle-orm"
import { type JobPayloads, sendJobs } from "../db/jobs.server.ts"
import { demands } from "../db/schema/demands.ts"
import { issues } from "../db/schema/issues.ts"
import { withTenant } from "../db/tenant.server.ts"
import type { NotificationTemplate } from "../shared/notifications.ts"

// Starting Values: 500 per batch
const BATCH_SIZE = 500

type Batch = { last: string | null; size: number; ids: string[] }

type Subject = {
  // Fixed identifiers, never input
  follows: "follows" | "demand_follows"
  column: "issue_id" | "demand_id"
  isPublic: (orgId: string, id: string) => Promise<boolean>
}

type FanOut = {
  orgId: string
  subjectId: string
  eventId: string
  template: NotificationTemplate
}

/** Every follower once, batched. */
function createFanOut(subject: Subject, batchSize: number) {
  const follows = sql.identifier(subject.follows)
  const column = sql.identifier(subject.column)
  return async (data: FanOut): Promise<number> => {
    // Drafts have no public page
    if (!(await subject.isPublic(data.orgId, data.subjectId))) return 0
    let after: string | null = null
    let created = 0
    for (;;) {
      const cursor = after
      const batch: Batch = await withTenant(data.orgId, async (tx) => {
        // Closed accounts lost membership
        const result = await tx.execute<Batch>(sql`
          WITH batch AS (
            SELECT f.org_id, f.${column} AS subject_id, f.user_id FROM ${follows} f
            JOIN members m ON m.organization_id = f.org_id AND m.user_id = f.user_id
            WHERE f.${column} = ${data.subjectId}
              AND (${cursor}::uuid IS NULL OR f.user_id > ${cursor}::uuid)
            ORDER BY f.user_id
            LIMIT ${batchSize}
          ), inserted AS (
            INSERT INTO notifications (org_id, user_id, event_id, template, ${column})
            SELECT org_id, user_id, ${data.eventId}, ${data.template}, subject_id FROM batch
            ON CONFLICT (org_id, event_id, user_id) DO NOTHING
            RETURNING id
          )
          SELECT
            (SELECT user_id FROM batch ORDER BY user_id DESC LIMIT 1)::text AS last,
            (SELECT count(*) FROM batch)::int AS size,
            ARRAY(SELECT id::text FROM inserted) AS ids
        `)
        const row = result.rows[0]
        if (!row) throw new Error("fan-out returned no row")
        await sendJobs(
          tx,
          "email-send",
          row.ids.map((id) => ({ orgId: data.orgId, notificationId: id })),
        )
        return row
      })
      created += batch.ids.length
      if (batch.size < batchSize || !batch.last) return created
      after = batch.last
    }
  }
}

/** Item 3: every follower, once. */
export function createIssueNotifyHandler(options: { batchSize?: number } = {}) {
  const fanOut = createFanOut(
    {
      follows: "follows",
      column: "issue_id",
      isPublic: (orgId, id) =>
        withTenant(orgId, async (tx) => {
          const [row] = await tx
            .select({
              published: sql<boolean>`${issues.publishedAt} IS NOT NULL`,
            })
            .from(issues)
            .where(eq(issues.id, id))
          // Empty read means wrong orgId
          if (!row) throw new Error("notified issue not found")
          return row.published
        }),
    },
    options.batchSize ?? BATCH_SIZE,
  )
  return (data: JobPayloads["issue-notify"]): Promise<number> =>
    fanOut({ ...data, subjectId: data.issueId })
}

/** Tuntutan followers, same rules. */
export function createDemandNotifyHandler(
  options: { batchSize?: number } = {},
) {
  const fanOut = createFanOut(
    {
      follows: "demand_follows",
      column: "demand_id",
      isPublic: (orgId, id) =>
        withTenant(orgId, async (tx) => {
          const [row] = await tx
            .select({ visible: sql<boolean>`${demands.state} <> 'draft'` })
            .from(demands)
            .where(eq(demands.id, id))
          if (!row) throw new Error("notified demand not found")
          return row.visible
        }),
    },
    options.batchSize ?? BATCH_SIZE,
  )
  return (data: JobPayloads["demand-notify"]): Promise<number> =>
    fanOut({ ...data, subjectId: data.demandId })
}
