import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { moderationDecisions } from "../../../db/schema/moderation.ts"
import {
  type EvidenceStatus,
  evidence,
  reports,
} from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { UPLOAD_CLOSED, UPLOAD_WINDOW_MS } from "../../../shared/evidence.ts"
import type { EvidenceKind } from "../../../shared/report-fields.ts"
import type { ReportStatus } from "../../../shared/status.ts"

export type PendingUpload = {
  id: string
  position: number
  name: string
  kind: EvidenceKind
  size: number
}

export type TrackedReport = {
  code: string
  title: string
  status: ReportStatus
  createdAt: Date
  verifiedAt: Date | null
  // Merge date, public issue code
  merged: { at: Date; code: string | null } | null
  evidence: EvidenceStatus[]
  // Owner may still send these
  pendingUploads: PendingUpload[]
  uploadUntil: Date | null
  // Rejected or not verifiable
  // Admin text only, no codes
  decision: { text: string } | null
}

// Recent first, three per page
const TRACK_PAGE_SIZE = 3
const DECIDED = new Set<ReportStatus>(["rejected", "unverifiable"])

export type OwnReports = {
  reports: TrackedReport[]
  page: number
  pageCount: number
}

/** Never reads report_contacts. */
async function trackedReports(
  tx: Tx,
  where: SQL | undefined,
  limit: number,
  offset = 0,
  now = new Date(),
): Promise<TrackedReport[]> {
  const rows = await tx
    .select({
      id: reports.id,
      code: reports.publicCode,
      title: reports.title,
      status: reports.status,
      createdAt: reports.createdAt,
      verifiedAt: reports.verifiedAt,
      mergedAt: issueReports.createdAt,
      issueCode: issues.publicCode,
      issuePublishedAt: issues.publishedAt,
    })
    .from(reports)
    .leftJoin(
      issueReports,
      and(
        eq(issueReports.orgId, reports.orgId),
        eq(issueReports.reportId, reports.id),
      ),
    )
    .leftJoin(
      issues,
      and(
        eq(issues.orgId, issueReports.orgId),
        eq(issues.id, issueReports.issueId),
      ),
    )
    .where(where)
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(limit)
    .offset(offset)
  if (rows.length === 0) return []
  const files = await tx
    .select({
      id: evidence.id,
      reportId: evidence.reportId,
      status: evidence.status,
      position: evidence.position,
      name: evidence.declaredName,
      kind: evidence.kind,
      size: evidence.declaredSize,
    })
    .from(evidence)
    .where(
      inArray(
        evidence.reportId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(evidence.position))
  // Newest decision wins per report
  const decisions = await tx
    .select({
      reportId: moderationDecisions.reportId,
      reason: moderationDecisions.reasonCode,
      text: moderationDecisions.reasonText,
    })
    .from(moderationDecisions)
    .where(
      inArray(
        moderationDecisions.reportId,
        rows.filter((row) => DECIDED.has(row.status)).map((row) => row.id),
      ),
    )
    .orderBy(desc(moderationDecisions.decidedAt))
  return rows.map(({ id, mergedAt, issueCode, issuePublishedAt, ...row }) => {
    const decision = DECIDED.has(row.status)
      ? decisions.find((d) => d.reportId === id)
      : undefined
    const own = files.filter((f) => f.reportId === id)
    const until = new Date(row.createdAt.getTime() + UPLOAD_WINDOW_MS)
    const open =
      until.getTime() > now.getTime() && !UPLOAD_CLOSED.includes(row.status)
    const pending = open
      ? own
          .filter((f) => f.status === "awaiting_upload")
          .map(({ id, position, name, kind, size }) => ({
            id,
            position,
            name,
            kind,
            size,
          }))
      : []
    return {
      ...row,
      merged: mergedAt
        ? { at: mergedAt, code: issuePublishedAt ? issueCode : null }
        : null,
      evidence: own.map((f) => f.status),
      pendingUploads: pending,
      uploadUntil: pending.length > 0 ? until : null,
      decision: decision?.text ? { text: decision.text } : null,
    }
  })
}

export function listOwnReports(
  orgId: string,
  userId: string,
  page = 1,
): Promise<OwnReports> {
  return withTenant(
    orgId,
    async (tx) => {
      const mine = eq(reports.userId, userId)
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(reports)
        .where(mine)
      const total = counted?.total ?? 0
      const pageCount = Math.max(1, Math.ceil(total / TRACK_PAGE_SIZE))
      // Past the end: caller redirects
      if (page > pageCount) return { reports: [], page, pageCount }
      const found = await trackedReports(
        tx,
        mine,
        TRACK_PAGE_SIZE,
        (page - 1) * TRACK_PAGE_SIZE,
      )
      return { reports: found, page, pageCount }
    },
    { role: "reporter" },
  )
}

/** Signed link, owner's report only. */
export function linkedReport(
  orgId: string,
  reportId: string,
  userId: string,
): Promise<TrackedReport | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const [found] = await trackedReports(
        tx,
        and(eq(reports.id, reportId), eq(reports.userId, userId)),
        1,
      )
      return found ?? null
    },
    { role: "reporter" },
  )
}

/** Success page confirms real reports. */
export function reportCodeExists(
  orgId: string,
  code: string,
): Promise<boolean> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.publicCode, code))
      .limit(1)
    return row !== undefined
  })
}
