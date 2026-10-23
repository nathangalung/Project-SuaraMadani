import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { notifyReporter } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { reports } from "../../../db/schema/reports.ts"
import { nextCounter, type Tx, withTenant } from "../../../db/tenant.server.ts"
import { jakartaMonth, jakartaYear } from "../../../shared/format.ts"
import { DISTRICT_MIN_REPORTS } from "../../../shared/report-fields.ts"
import { isTerminalIssue, REPORT_TRANSITIONS } from "../../../shared/status.ts"
import { formatIssueCode } from "../issues/issue-code.ts"
import { queueIssueEvidence } from "./evidence.server.ts"

const MERGEABLE = REPORT_TRANSITIONS.merge.from

export type MergeTarget =
  | { kind: "new"; title: string; summary: string }
  | { kind: "existing"; issueId: string }

export type MergeInput = {
  reportIds: string[]
  target: MergeTarget
  actorId: string
  campusCode: string
  now: Date
  // Sample seed opts out
  notify?: boolean
}

export type MergeResult =
  | {
      ok: true
      issueId: string
      code: string
      version: number
      published: boolean
    }
  | { ok: false; reason: "changed" | "not_found" }

class MergeRefused extends Error {
  readonly reason: "changed" | "not_found"

  constructor(reason: "changed" | "not_found") {
    super(`merge refused: ${reason}`)
    this.reason = reason
  }
}

type LockedIssue = { id: string; code: string; published: boolean }

async function lockIssue(tx: Tx, issueId: string): Promise<LockedIssue> {
  const [row] = await tx
    .select({
      id: issues.id,
      code: issues.publicCode,
      publishedAt: issues.publishedAt,
      takenDownAt: issues.takenDownAt,
      govStatus: issues.govStatus,
    })
    .from(issues)
    .where(eq(issues.id, issueId))
    .for("update")
  // Removed or finished take none
  if (!row || row.takenDownAt || isTerminalIssue(row.govStatus)) {
    throw new MergeRefused("not_found")
  }
  return { id: row.id, code: row.code, published: row.publishedAt !== null }
}

async function createIssue(
  tx: Tx,
  orgId: string,
  input: MergeInput & { target: { kind: "new" } },
): Promise<LockedIssue> {
  // Number first: fixed lock order
  const year = jakartaYear(input.now)
  const month = jakartaMonth(input.now)
  const number = await nextCounter(tx, orgId, { year, month }, "issue")
  const [source] = await tx
    .select({
      categoryId: reports.categoryId,
      subcategoryId: reports.subcategoryId,
      provinceCode: reports.provinceCode,
      regencyCode: reports.regencyCode,
    })
    .from(reports)
    .where(inArray(reports.id, input.reportIds))
    .orderBy(asc(reports.createdAt))
    .limit(1)
  if (!source) throw new MergeRefused("changed")
  const code = formatIssueCode(year, month, number)
  const [row] = await tx
    .insert(issues)
    .values({
      orgId,
      year,
      month,
      number,
      publicCode: code,
      title: input.target.title,
      summary: input.target.summary,
      ...source,
    })
    .returning({ id: issues.id })
  if (!row) throw new Error("issue not inserted")
  await tx.insert(auditLog).values({
    orgId,
    actorId: input.actorId,
    action: "issue.create",
    entityType: "issue",
    entityId: row.id,
    changedColumns: ["title", "summary"],
  })
  return { id: row.id, code, published: false }
}

// Inside UPDATE issues only
export const DISTRICT_OF_ISSUE = sql`(
  SELECT r.district_code FROM issue_reports ir
  JOIN reports r ON r.org_id = ir.org_id AND r.id = ir.report_id
  WHERE ir.issue_id = issues.id AND r.regency_code = issues.regency_code
  GROUP BY r.district_code
  HAVING count(*) >= ${DISTRICT_MIN_REPORTS}
  ORDER BY count(*) DESC, r.district_code
  LIMIT 1
)`

/** Counts, label, kecamatan from issue_reports. */
/** Returns the new version. */
export async function recomputeIssue(
  tx: Tx,
  issueId: string,
  bump: boolean,
): Promise<number> {
  const result = await tx.execute<{ version: number }>(sql`
    UPDATE issues SET
      report_count = s.n,
      verified_report_count = s.v,
      verification_label = CASE WHEN s.v > 0 THEN 'verified' ELSE 'unverified' END,
      district_code = ${DISTRICT_OF_ISSUE},
      last_activity_at = now(),
      updated_at = now(),
      version = issues.version + ${bump ? 1 : 0}
    FROM (
      SELECT count(*)::int AS n, count(r.verified_at)::int AS v
      FROM issue_reports ir
      JOIN reports r ON r.org_id = ir.org_id AND r.id = ir.report_id
      WHERE ir.issue_id = ${issueId}
    ) s
    WHERE issues.id = ${issueId}
    RETURNING issues.version
  `)
  return result.rows[0]?.version ?? 0
}

/** Throws to roll back. */
async function mergeIntoIssue(
  tx: Tx,
  orgId: string,
  input: MergeInput,
): Promise<LockedIssue & { version: number }> {
  const target = input.target
  const issue =
    target.kind === "existing"
      ? await lockIssue(tx, target.issueId)
      : await createIssue(tx, orgId, { ...input, target })
  const ids = [...new Set(input.reportIds)].sort()
  await tx
    .select({ id: reports.id })
    .from(reports)
    .where(inArray(reports.id, ids))
    .orderBy(asc(reports.id))
    .for("update")
  const merged = await tx
    .update(reports)
    .set({ status: "merged", updatedAt: sql`now()` })
    .where(and(inArray(reports.id, ids), inArray(reports.status, MERGEABLE)))
    .returning({ id: reports.id })
  if (merged.length !== ids.length) throw new MergeRefused("changed")
  await tx
    .insert(issueReports)
    .values(ids.map((reportId) => ({ orgId, issueId: issue.id, reportId })))
  const version = await recomputeIssue(tx, issue.id, target.kind === "existing")
  // Public count changed, timeline
  if (issue.published) {
    await tx.execute(sql`
      INSERT INTO issue_events (org_id, issue_id, action, advocacy_status, gov_status)
      SELECT org_id, id, 'merge', advocacy_status, gov_status FROM issues
      WHERE id = ${issue.id}`)
    await queueIssueEvidence(tx, orgId, issue.id)
  }
  const events = await tx
    .insert(auditLog)
    .values(
      ids.map((reportId) => ({
        orgId,
        actorId: input.actorId,
        action: "report.merge",
        entityType: "report",
        entityId: reportId,
        changedColumns: ["status"],
      })),
    )
    .returning({ id: auditLog.id, reportId: auditLog.entityId })
  // Reporters follow their issue
  await tx.execute(sql`
    INSERT INTO follows (org_id, issue_id, user_id)
    SELECT DISTINCT ${orgId}::uuid, ${issue.id}::uuid, r.user_id FROM reports r
    WHERE r.id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    ON CONFLICT DO NOTHING
  `)
  if (input.notify !== false) {
    for (const event of events) {
      if (!event.reportId) continue
      await notifyReporter(tx, {
        orgId,
        reportId: event.reportId,
        eventId: event.id,
        template: "report_merged",
      })
    }
  }
  return { ...issue, version }
}

/** Maps refusals to results. */
export async function runMerge(
  orgId: string,
  input: MergeInput,
): Promise<MergeResult> {
  try {
    const issue = await withTenant(
      orgId,
      (tx) => mergeIntoIssue(tx, orgId, input),
      { role: "admin" },
    )
    return {
      ok: true,
      issueId: issue.id,
      code: issue.code,
      version: issue.version,
      published: issue.published,
    }
  } catch (error) {
    if (error instanceof MergeRefused)
      return { ok: false, reason: error.reason }
    throw error
  }
}
