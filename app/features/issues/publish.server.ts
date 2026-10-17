import { and, eq, gt, isNull, sql } from "drizzle-orm"
import { notifyFollowers } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { issues } from "../../../db/schema/issues.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { type PurgeDeps, purgeQuietly } from "../../../server/purge.server.ts"
import { queueIssueEvidence } from "../moderation/evidence.server.ts"

export type PublishInput = {
  issueId: string
  actorId: string
  // Sample seed opts out
  notify?: boolean
}
export type PublishResult =
  | { ok: true; code: string; version: number }
  | { ok: false; reason: "changed" }

/** Sets published_at once, bumps version. */
async function publishIssue(
  tx: Tx,
  orgId: string,
  input: PublishInput,
): Promise<PublishResult> {
  const [row] = await tx
    .update(issues)
    .set({
      publishedAt: sql`now()`,
      lastActivityAt: sql`now()`,
      updatedAt: sql`now()`,
      version: sql`${issues.version} + 1`,
    })
    .where(
      and(
        eq(issues.id, input.issueId),
        eq(issues.orgId, orgId),
        isNull(issues.publishedAt),
        // Taken down stays down
        isNull(issues.takenDownAt),
        gt(issues.reportCount, 0),
      ),
    )
    .returning({ code: issues.publicCode, version: issues.version })
  if (!row) return { ok: false, reason: "changed" }
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId,
      actorId: input.actorId,
      action: "issue.publish",
      entityType: "issue",
      entityId: input.issueId,
      changedColumns: ["published_at", "version"],
    })
    .returning({ id: auditLog.id })
  // Earlier approvals go public now
  await queueIssueEvidence(tx, orgId, input.issueId)
  if (event && input.notify !== false) {
    await notifyFollowers(tx, {
      orgId,
      issueId: input.issueId,
      eventId: event.id,
      template: "issue_published",
    })
  }
  return { ok: true, code: row.code, version: row.version }
}

export type PurgedIssue = { code: string; version: number }

/** Single-file purge targets, ADR-02. */
export function issuePurgeUrls(host: string, issue: PurgedIssue): string[] {
  const origin = `https://${host}`
  const { code } = issue
  // Every version is cached
  const images = Array.from(
    { length: issue.version },
    (_, index) => `${origin}/isu/${code}/og.png?v=${index + 1}`,
  )
  return [
    `${origin}/isu/${code}`,
    `${origin}/isu/${code}.data`,
    `${origin}/isu`,
    `${origin}/isu.data`,
    `${origin}/`,
    `${origin}/_root.data`,
    `${origin}/data`,
    `${origin}/data.data`,
    ...images,
  ]
}

export type { PurgeDeps }

/** After commit, never throws. */
export function purgeIssuePages(
  host: string,
  issue: PurgedIssue,
  deps: PurgeDeps = {},
): Promise<void> {
  return purgeQuietly(
    issuePurgeUrls(host, issue),
    { host, issue: issue.code },
    deps,
  )
}

export async function runPublish(
  tenant: { id: string; host: string },
  input: PublishInput,
  deps: PurgeDeps = {},
): Promise<PublishResult> {
  const result = await withTenant(
    tenant.id,
    (tx) => publishIssue(tx, tenant.id, input),
    { role: "admin" },
  )
  if (result.ok) await purgeIssuePages(tenant.host, result, deps)
  return result
}
