import { and, eq, inArray, sql } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { members, sessions, users } from "../../../db/schema/auth.ts"
import { demandFollows } from "../../../db/schema/demands.ts"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { follows } from "../../../db/schema/notifications.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { publicFiles } from "../../../shared/evidence.ts"
import type { CloseAccountReason } from "../../../shared/moderation.ts"
import { recomputeIssue } from "./merge.server.ts"
import { queueTakedown } from "./takedown.server.ts"

export type CloseAccountInput = {
  tenant: { id: string; host: string }
  // Report identifies the account
  reportId: string
  reason: CloseAccountReason
  actorId: string
}

export type CloseAccountResult =
  | { ok: true; reports: number; issues: string[]; unpublished: string[] }
  | { ok: false; reason: "not_found" | "staff" }

type Removed = {
  reports: number
  issues: string[]
  unpublished: string[]
}

// Never close a colleague's account
const STAFF = ["editor", "admin"] as const

async function removeAtCampus(
  tx: Tx,
  input: CloseAccountInput,
): Promise<Removed | "not_found" | "staff"> {
  const orgId = input.tenant.id
  const [owner] = await tx
    .select({ userId: reports.userId })
    .from(reports)
    .where(eq(reports.id, input.reportId))
  if (!owner) return "not_found"
  const { userId } = owner
  if (userId === input.actorId) return "staff"
  // Staff anywhere, sessions span campuses
  const [staff] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        sql`(${users.superadmin} OR EXISTS (SELECT 1 FROM ${members} WHERE ${members.userId} = ${users.id} AND ${inArray(members.role, [...STAFF])}))`,
      ),
    )
  if (staff) return "staff"
  const owned = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(reports.id)
    .for("update")
  const ids = owned.map((row) => row.id)
  const files = await tx
    .select({ id: evidence.id, media: evidence.publicMedia })
    .from(evidence)
    .where(inArray(evidence.reportId, ids))
  const links = await tx
    .delete(issueReports)
    .where(inArray(issueReports.reportId, ids))
    .returning({ issueId: issueReports.issueId })
  const touched = [...new Set(links.map((link) => link.issueId))].sort()
  for (const issueId of touched) await recomputeIssue(tx, issueId, true)
  // Empty issues leave public view
  const emptied =
    touched.length === 0
      ? []
      : await tx
          .update(issues)
          .set({ publishedAt: null, updatedAt: sql`now()` })
          .where(
            and(
              inArray(issues.id, touched),
              eq(issues.reportCount, 0),
              sql`${issues.publishedAt} IS NOT NULL`,
            ),
          )
          .returning({ code: issues.publicCode })
  const codes =
    touched.length === 0
      ? []
      : await tx
          .select({ code: issues.publicCode })
          .from(issues)
          .where(inArray(issues.id, touched))
  await tx.delete(reports).where(inArray(reports.id, ids))
  await tx.delete(follows).where(eq(follows.userId, userId))
  await tx.delete(demandFollows).where(eq(demandFollows.userId, userId))
  await tx
    .delete(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, userId)))
  // Signed out on every campus
  await tx.delete(sessions).where(eq(sessions.userId, userId))
  // Takedown job deletes files
  await queueTakedown(tx, orgId, {
    action: "remove_on_request",
    issueId: null,
    complaintId: null,
    publicFiles: files.flatMap((row) => publicFiles(row.media)),
    evidenceIds: files.map((row) => row.id),
    actorId: input.actorId,
  })
  await tx.insert(auditLog).values({
    orgId,
    actorId: input.actorId,
    // Adults by request, minors otherwise
    action:
      input.reason === "data_subject_request"
        ? "account.close"
        : "account.close_minor",
    entityType: "user",
    entityId: userId,
    changedColumns: ["members", "reports", "sessions"],
    reasonCode: input.reason,
  })
  return {
    reports: ids.length,
    issues: codes.map((row) => row.code).sort(),
    unpublished: emptied.map((row) => row.code).sort(),
  }
}

/** Minor or data owner. */
export async function closeAccount(
  input: CloseAccountInput,
): Promise<CloseAccountResult> {
  const removed = await withTenant(
    input.tenant.id,
    (tx) => removeAtCampus(tx, input),
    { role: "admin" },
  )
  if (typeof removed === "string") return { ok: false, reason: removed }
  return { ok: true, ...removed }
}
