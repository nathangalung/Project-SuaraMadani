import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { moderationDecisions } from "../../../db/schema/moderation.ts"
import { organizations } from "../../../db/schema/organizations.ts"
import {
  type EvidenceStatus,
  evidence,
  reports,
} from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { originFor } from "../../../server/origin.server.ts"
import { UPLOAD_CLOSED, UPLOAD_WINDOW_MS } from "../../../shared/evidence.ts"
import {
  type DecisionReason,
  isDecisionReason,
} from "../../../shared/moderation.ts"
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
  decision: { reason: DecisionReason; text: string } | null
  // Their own /lacak page
  forwardedTo: { campus: string; url: string } | null
}

// Recent first, one page
const LIMIT = 50
const DECIDED = new Set<ReportStatus>(["rejected", "unverifiable"])

export type OwnReports = { reports: TrackedReport[]; capped: boolean }

/** Never reads report_contacts. */
async function trackedReports(
  tx: Tx,
  where: SQL | undefined,
  limit: number,
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
      forwardCampus: organizations.campusName,
      forwardHost: organizations.host,
    })
    .from(reports)
    .leftJoin(organizations, eq(organizations.id, reports.forwardedToOrgId))
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
    .orderBy(desc(reports.createdAt))
    .limit(limit)
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
  return rows.map(
    ({
      id,
      mergedAt,
      issueCode,
      issuePublishedAt,
      forwardCampus,
      forwardHost,
      ...row
    }) => {
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
        decision:
          decision?.text && isDecisionReason(decision.reason)
            ? { reason: decision.reason, text: decision.text }
            : null,
        forwardedTo:
          forwardCampus && forwardHost
            ? { campus: forwardCampus, url: `${originFor(forwardHost)}/lacak` }
            : null,
      }
    },
  )
}

export function listOwnReports(
  orgId: string,
  userId: string,
): Promise<OwnReports> {
  return withTenant(
    orgId,
    async (tx) => {
      const found = await trackedReports(
        tx,
        eq(reports.userId, userId),
        LIMIT + 1,
      )
      const capped = found.length > LIMIT
      if (capped) found.length = LIMIT
      return { reports: found, capped }
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
