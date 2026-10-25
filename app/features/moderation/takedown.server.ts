import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { sendJob } from "../../../db/jobs.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import {
  demandItems,
  demands,
  policyBriefs,
} from "../../../db/schema/demands.ts"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { takedowns } from "../../../db/schema/moderation.ts"
import { evidence } from "../../../db/schema/reports.ts"
import type { Tx } from "../../../db/tenant.server.ts"
import type { TakedownReason } from "../../../shared/complaints.ts"
import { type PublicFile, publicFiles } from "../../../shared/evidence.ts"
import type { TakedownAction } from "../../../shared/moderation.ts"
import { citedIssues, type PurgedDemand } from "../demands/purge.server.ts"

/** Published copies back to ready. */
async function withdrawEvidence(
  tx: Tx,
  issueId: string,
  options: { only?: readonly string[]; withholdBy?: string } = {},
): Promise<PublicFile[]> {
  if (options.only?.length === 0) return []
  const rows = await tx
    .select({ id: evidence.id, media: evidence.publicMedia })
    .from(evidence)
    .innerJoin(
      issueReports,
      and(
        eq(issueReports.orgId, evidence.orgId),
        eq(issueReports.reportId, evidence.reportId),
      ),
    )
    .where(
      and(
        eq(issueReports.issueId, issueId),
        eq(evidence.status, "published"),
        options.only ? inArray(evidence.id, [...options.only]) : undefined,
      ),
    )
    .orderBy(evidence.id)
    .for("update", { of: evidence })
  if (rows.length === 0) return []
  await tx
    .update(evidence)
    .set({
      status: "ready",
      publicMedia: null,
      publishedAt: null,
      updatedAt: sql`now()`,
      // Edit withholds, hide keeps decision
      ...(options.withholdBy
        ? {
            decision: "withhold" as const,
            decidedBy: options.withholdBy,
            decidedAt: sql`now()`,
          }
        : {}),
    })
    .where(
      inArray(
        evidence.id,
        rows.map((row) => row.id),
      ),
    )
  return rows.flatMap((row) => publicFiles(row.media))
}

export type TakedownInput = {
  action: TakedownAction
  issueId: string | null
  publicFiles: PublicFile[]
  evidenceIds: string[]
  actorId: string
}

/** Row plus job, same transaction. */
export async function queueTakedown(
  tx: Tx,
  orgId: string,
  input: TakedownInput,
): Promise<string> {
  const [row] = await tx
    .insert(takedowns)
    .values({
      orgId,
      action: input.action,
      issueId: input.issueId,
      publicFiles: input.publicFiles,
      evidenceIds: input.evidenceIds,
      createdBy: input.actorId,
    })
    .returning({ id: takedowns.id })
  if (!row) throw new Error("takedown not inserted")
  await sendJob(tx, "takedown", { orgId, takedownId: row.id })
  return row.id
}

export type WithdrawResult = { ok: true } | { ok: false; reason: "not_allowed" }

/** Hide or take down. */
export async function withdrawIssue(
  tx: Tx,
  orgId: string,
  issue: { id: string; publishedAt: Date | null; takenDownAt: Date | null },
  input: { remove: boolean; reason: TakedownReason; actorId: string },
): Promise<WithdrawResult> {
  if (issue.takenDownAt) return { ok: false, reason: "not_allowed" }
  if (!input.remove && !issue.publishedAt) {
    return { ok: false, reason: "not_allowed" }
  }
  const { remove, reason } = input
  await tx
    .update(issues)
    .set({
      publishedAt: null,
      ...(remove ? { takenDownAt: sql`now()`, takedownReason: reason } : {}),
      version: sql`${issues.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(issues.id, issue.id))
  const files = await withdrawEvidence(tx, issue.id)
  await tx.insert(auditLog).values({
    orgId,
    actorId: input.actorId,
    action: remove ? "issue.take_down" : "issue.unpublish",
    entityType: "issue",
    entityId: issue.id,
    changedColumns: remove
      ? ["published_at", "taken_down_at", "version"]
      : ["published_at", "version"],
    reasonCode: reason,
  })
  await queueTakedown(tx, orgId, {
    action: remove ? "take_down" : "unpublish",
    issueId: issue.id,
    publicFiles: files,
    evidenceIds: [],
    actorId: input.actorId,
  })
  return { ok: true }
}

/** Draft again, audited, durable purge. */
export async function hideDemand(
  tx: Tx,
  orgId: string,
  demand: { id: string; code: string },
  input: { reason: TakedownReason; actorId: string },
): Promise<PurgedDemand> {
  const [hidden] = await tx
    .update(demands)
    .set({
      state: "draft",
      closedAt: null,
      hiddenAt: sql`now()`,
      hiddenReason: input.reason,
      version: sql`${demands.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(demands.id, demand.id))
    .returning({ version: demands.version })
  if (!hidden) throw new Error("demand not hidden")
  await tx.insert(auditLog).values({
    orgId,
    actorId: input.actorId,
    action: "demand.hide",
    entityType: "demand",
    entityId: demand.id,
    changedColumns: ["state", "hidden_at", "version"],
    reasonCode: input.reason,
  })
  // CMP-18: retried, takedown_late alerts
  await queueTakedown(tx, orgId, {
    action: "unpublish",
    issueId: null,
    publicFiles: [],
    evidenceIds: [],
    actorId: input.actorId,
  })
  // Hidden PDFs leave the CDN
  const briefs = await tx
    .select({ id: policyBriefs.id })
    .from(policyBriefs)
    .innerJoin(demandItems, eq(demandItems.id, policyBriefs.itemId))
    .where(
      and(
        eq(demandItems.demandId, demand.id),
        isNotNull(policyBriefs.publishedAt),
      ),
    )
  return {
    code: demand.code,
    version: hidden.version,
    briefs: briefs.map((row) => row.id),
    issues: await citedIssues(tx, demand.id),
  }
}
