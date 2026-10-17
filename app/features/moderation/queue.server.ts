import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { type MemberRole, members } from "../../../db/schema/auth.ts"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import { moderationDecisions } from "../../../db/schema/moderation.ts"
import { organizations } from "../../../db/schema/organizations.ts"
import { regions } from "../../../db/schema/regions.ts"
import {
  type EvidenceStatus,
  evidence,
  reports,
} from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import type {
  EvidenceDecision,
  EvidenceFailure,
} from "../../../shared/evidence.ts"
import {
  type DecisionReason,
  isDecisionReason,
} from "../../../shared/moderation.ts"
import type { EvidenceKind } from "../../../shared/report-fields.ts"
import {
  type AdvocacyStatus,
  type GovernmentStatus,
  type ReportStatus,
  TERMINAL_GOVERNMENT,
  type VerificationLabel,
} from "../../../shared/status.ts"
import { type IssueRecord, readIssueRecord } from "../issues/record.server.ts"
import { QUEUE_STATUSES, type QueueStatus } from "./fields.ts"

const QUEUE_LIMIT = 200
const TARGET_LIMIT = 50

export type QueueRow = {
  code: string
  title: string
  subcategoryId: string
  status: ReportStatus
  createdAt: Date
  files: number
  ready: number
  // Campus that forwarded it
  forwardedFrom: string | null
}

/** Oldest first, contacts never read. */
export function listQueue(
  orgId: string,
  role: MemberRole,
  status: QueueStatus | null = null,
): Promise<QueueRow[]> {
  return withTenant(
    orgId,
    (tx) =>
      tx
        .select({
          code: reports.publicCode,
          title: reports.title,
          subcategoryId: reports.subcategoryId,
          status: reports.status,
          createdAt: reports.createdAt,
          files: count(evidence.id),
          ready: sql<number>`count(*) FILTER (WHERE ${evidence.status} IN ('ready', 'published'))::int`,
          forwardedFrom: organizations.campusName,
        })
        .from(reports)
        .leftJoin(
          evidence,
          and(
            eq(evidence.orgId, reports.orgId),
            eq(evidence.reportId, reports.id),
          ),
        )
        .leftJoin(
          organizations,
          eq(organizations.id, reports.forwardedFromOrgId),
        )
        .where(
          status
            ? eq(reports.status, status)
            : inArray(reports.status, QUEUE_STATUSES),
        )
        .groupBy(reports.id, organizations.campusName)
        .orderBy(asc(reports.createdAt))
        .limit(QUEUE_LIMIT),
    { role },
  )
}

const province = alias(regions, "province")
const regency = alias(regions, "regency")
const district = alias(regions, "district")
const village = alias(regions, "village")

type ReviewEvidence = {
  id: string
  position: number
  status: EvidenceStatus
  declaredName: string
  kind: EvidenceKind
  previewPages: number
  sourcePages: number | null
  durationMs: number | null
  failureReason: EvidenceFailure | null
  scanned: boolean
  decision: EvidenceDecision | null
  boxes: number
}

type ReviewDecisionView = {
  reason: DecisionReason
  text: string
  decidedAt: Date
}

export type ReviewReport = Omit<
  NonNullable<Awaited<ReturnType<typeof readReport>>>,
  "forwardedFromOrgId" | "forwardedToOrgId"
> & {
  evidence: ReviewEvidence[]
  issue: { code: string; title: string } | null
  decision: ReviewDecisionView | null
  forwardedFrom: string | null
  forwardedTo: { id: string; name: string } | null
}

async function readReport(tx: Tx, code: string) {
  const [row] = await tx
    .select({
      id: reports.id,
      code: reports.publicCode,
      status: reports.status,
      relation: reports.relation,
      otherConsent: reports.otherConsent,
      title: reports.title,
      story: reports.story,
      categoryId: reports.categoryId,
      subcategoryId: reports.subcategoryId,
      occurredOn: reports.occurredOn,
      agency: reports.agency,
      urgency: reports.urgency,
      affectedGroups: reports.affectedGroups,
      affectedCount: reports.affectedCount,
      ongoing: reports.ongoing,
      contactable: reports.contactable,
      forwardConsent: sql<boolean>`${reports.consents} @> ARRAY['forward_to_agency']::text[]`,
      provinceName: province.name,
      regencyName: regency.name,
      regencyCode: reports.regencyCode,
      districtName: district.name,
      villageName: village.name,
      createdAt: reports.createdAt,
      verifiedAt: reports.verifiedAt,
      forwardedFromOrgId: reports.forwardedFromOrgId,
      forwardedToOrgId: reports.forwardedToOrgId,
    })
    .from(reports)
    .innerJoin(province, eq(province.code, reports.provinceCode))
    .innerJoin(regency, eq(regency.code, reports.regencyCode))
    .innerJoin(district, eq(district.code, reports.districtCode))
    .leftJoin(village, eq(village.code, reports.villageCode))
    .where(eq(reports.publicCode, code))
    .limit(1)
  return row
}

/** Null means 404. */
export function getReviewReport(
  orgId: string,
  role: MemberRole,
  code: string,
): Promise<ReviewReport | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const report = await readReport(tx, code)
      if (!report) return null
      const files = await tx
        .select({
          id: evidence.id,
          position: evidence.position,
          status: evidence.status,
          declaredName: evidence.declaredName,
          kind: evidence.kind,
          previewPages: evidence.previewPages,
          sourcePages: evidence.sourcePages,
          durationMs: evidence.durationMs,
          failureReason: evidence.failureReason,
          scanned: sql<boolean>`${evidence.scannedAt} IS NOT NULL`,
          decision: evidence.decision,
          boxes: sql<number>`jsonb_array_length(${evidence.redactionBoxes})`,
        })
        .from(evidence)
        .where(eq(evidence.reportId, report.id))
        .orderBy(asc(evidence.position))
      const [issue] = await tx
        .select({ code: issues.publicCode, title: issues.title })
        .from(issueReports)
        .innerJoin(
          issues,
          and(
            eq(issues.orgId, issueReports.orgId),
            eq(issues.id, issueReports.issueId),
          ),
        )
        .where(eq(issueReports.reportId, report.id))
        .limit(1)
      const [decision] = await tx
        .select({
          reason: moderationDecisions.reasonCode,
          text: moderationDecisions.reasonText,
          decidedAt: moderationDecisions.decidedAt,
        })
        .from(moderationDecisions)
        .where(
          and(
            eq(moderationDecisions.reportId, report.id),
            inArray(moderationDecisions.action, [
              "reject",
              "mark_unverifiable",
            ]),
          ),
        )
        .orderBy(desc(moderationDecisions.decidedAt))
        .limit(1)
      const { forwardedFromOrgId, forwardedToOrgId, ...rest } = report
      const campus = async (id: string | null) => {
        if (!id) return null
        const [org] = await tx
          .select({ name: organizations.campusName })
          .from(organizations)
          .where(eq(organizations.id, id))
        return org?.name ?? null
      }
      const toName = await campus(forwardedToOrgId)
      return {
        ...rest,
        evidence: files,
        issue: issue ?? null,
        decision:
          decision?.text && isDecisionReason(decision.reason)
            ? {
                reason: decision.reason,
                text: decision.text,
                decidedAt: decision.decidedAt,
              }
            : null,
        forwardedFrom: await campus(forwardedFromOrgId),
        forwardedTo:
          forwardedToOrgId && toName
            ? { id: forwardedToOrgId, name: toName }
            : null,
      }
    },
    { role },
  )
}

export type MergeTargetOption = {
  id: string
  code: string
  title: string
  sameRegency: boolean
}

export type MergeTargetInput = {
  regencyCode: string
  title: string
  // Admin search, code or words
  query?: string
}

const CODE_QUERY = /^ISU-[A-Z0-9]{2,10}-\d{2}-\d{4}$/

/** PLAN §5.6: trigram and FTS. */
export function listMergeTargets(
  orgId: string,
  role: MemberRole,
  input: MergeTargetInput,
): Promise<MergeTargetOption[]> {
  const query = input.query?.trim().slice(0, 100) ?? ""
  const code = query.toUpperCase()
  const sameRegency = sql<boolean>`${issues.regencyCode} = ${input.regencyCode}`
  const filter =
    query === ""
      ? undefined
      : CODE_QUERY.test(code)
        ? eq(issues.publicCode, code)
        : sql`(${issues.title} ILIKE ${`%${query.replace(/[\\%_]/g, "\\$&")}%`} OR ${issues.search} @@ plainto_tsquery('indonesian', ${query}) OR ${issues.title} % ${query})`
  const like = query === "" ? input.title : query
  return withTenant(
    orgId,
    (tx) =>
      tx
        .select({
          id: issues.id,
          code: issues.publicCode,
          title: issues.title,
          sameRegency,
        })
        .from(issues)
        .where(
          and(
            isNull(issues.takenDownAt),
            notInArray(issues.govStatus, [...TERMINAL_GOVERNMENT]),
            filter,
          ),
        )
        .orderBy(
          desc(sameRegency),
          desc(sql`similarity(${issues.title}, ${like})`),
          desc(
            sql`ts_rank(${issues.search}, plainto_tsquery('indonesian', ${like}))`,
          ),
          desc(issues.lastActivityAt),
        )
        .limit(TARGET_LIMIT),
    { role },
  )
}

export type ManagedIssue = {
  id: string
  code: string
  title: string
  summary: string
  verificationLabel: VerificationLabel
  advocacyStatus: AdvocacyStatus
  govStatus: GovernmentStatus
  reportCount: number
  regencyName: string
  publishedAt: Date | null
  takenDownAt: Date | null
  version: number
  // forwardConsent: step 7 box
  reports: { code: string; title: string; forwardConsent: boolean }[]
  subcategoryId: string
  regencyCode: string
  record: IssueRecord
}

/** Unpublished issues too, staff only. */
export function getManagedIssue(
  orgId: string,
  role: MemberRole,
  code: string,
): Promise<ManagedIssue | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const [issue] = await tx
        .select({
          id: issues.id,
          code: issues.publicCode,
          title: issues.title,
          summary: issues.summary,
          verificationLabel: issues.verificationLabel,
          advocacyStatus: issues.advocacyStatus,
          govStatus: issues.govStatus,
          reportCount: issues.reportCount,
          regencyName: regency.name,
          publishedAt: issues.publishedAt,
          takenDownAt: issues.takenDownAt,
          version: issues.version,
          subcategoryId: issues.subcategoryId,
          regencyCode: issues.regencyCode,
        })
        .from(issues)
        .innerJoin(regency, eq(regency.code, issues.regencyCode))
        .where(eq(issues.publicCode, code))
        .limit(1)
      if (!issue) return null
      const linked = await tx
        .select({
          code: reports.publicCode,
          title: reports.title,
          forwardConsent: sql<boolean>`${reports.consents} @> ARRAY['forward_to_agency']::text[]`,
        })
        .from(issueReports)
        .innerJoin(
          reports,
          and(
            eq(reports.orgId, issueReports.orgId),
            eq(reports.id, issueReports.reportId),
          ),
        )
        .where(eq(issueReports.issueId, issue.id))
        .orderBy(asc(reports.createdAt))
      return {
        ...issue,
        reports: linked,
        record: await readIssueRecord(tx, issue.id),
      }
    },
    { role },
  )
}

/** Copy at the receiving campus. */
export function forwardCopyCode(
  targetOrgId: string,
  reportId: string,
): Promise<string | null> {
  return withTenant(
    targetOrgId,
    async (tx) => {
      const [copy] = await tx
        .select({ code: reports.publicCode })
        .from(reports)
        .where(eq(reports.forwardedFromReportId, reportId))
      return copy?.code ?? null
    },
    { role: "admin" },
  )
}

export type CloseImpact = { reports: number; issues: number; staff: boolean }

/** What closing would remove here. */
export function closeImpact(
  orgId: string,
  role: MemberRole,
  reportId: string,
  actorId: string,
): Promise<CloseImpact> {
  return withTenant(
    orgId,
    async (tx) => {
      const [owner] = await tx
        .select({ userId: reports.userId })
        .from(reports)
        .where(eq(reports.id, reportId))
      if (!owner) return { reports: 0, issues: 0, staff: false }
      const [member] = await tx
        .select({ role: members.role })
        .from(members)
        .where(
          and(
            eq(members.organizationId, orgId),
            eq(members.userId, owner.userId),
          ),
        )
      const staff =
        owner.userId === actorId ||
        (member !== undefined && member.role !== "reporter")
      const [counts] = await tx
        .select({
          reports: sql<number>`count(DISTINCT ${reports.id})::int`,
          issues: sql<number>`count(DISTINCT ${issueReports.issueId})::int`,
        })
        .from(reports)
        .leftJoin(
          issueReports,
          and(
            eq(issueReports.orgId, reports.orgId),
            eq(issueReports.reportId, reports.id),
          ),
        )
        .where(eq(reports.userId, owner.userId))
      return {
        reports: counts?.reports ?? 0,
        issues: counts?.issues ?? 0,
        staff,
      }
    },
    { role },
  )
}
