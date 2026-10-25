import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { sendJob } from "../../../db/jobs.server.ts"
import { issueReports } from "../../../db/schema/issues.ts"
import { takedowns } from "../../../db/schema/moderation.ts"
import { evidence } from "../../../db/schema/reports.ts"
import type { Tx } from "../../../db/tenant.server.ts"
import { type PublicFile, publicFiles } from "../../../shared/evidence.ts"
import type { PurgeStatus, TakedownAction } from "../../../shared/moderation.ts"

/** Published copies back to ready. */
export async function withdrawEvidence(
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
  complaintId: string | null
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
      complaintId: input.complaintId,
      publicFiles: input.publicFiles,
      evidenceIds: input.evidenceIds,
      createdBy: input.actorId,
    })
    .returning({ id: takedowns.id })
  if (!row) throw new Error("takedown not inserted")
  await sendJob(tx, "takedown", { orgId, takedownId: row.id })
  return row.id
}

export type TakedownView = {
  id: string
  action: TakedownAction
  purgeStatus: PurgeStatus
  createdAt: Date
  doneAt: Date | null
}

/** Admin sees purge progress. */
export function listTakedowns(
  tx: Tx,
  complaintId: string,
): Promise<TakedownView[]> {
  return tx
    .select({
      id: takedowns.id,
      action: takedowns.action,
      purgeStatus: takedowns.purgeStatus,
      createdAt: takedowns.createdAt,
      doneAt: takedowns.doneAt,
    })
    .from(takedowns)
    .where(eq(takedowns.complaintId, complaintId))
    .orderBy(desc(takedowns.createdAt))
    .limit(20)
}
