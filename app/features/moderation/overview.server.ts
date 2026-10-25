import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm"
import type { MemberRole } from "../../../db/schema/auth.ts"
import { issues } from "../../../db/schema/issues.ts"
import { reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import {
  type AdvocacyStatus,
  type GovernmentStatus,
  type PublicStage,
  STAGE_GOVERNMENT,
  type VerificationLabel,
} from "../../../shared/status.ts"
import {
  ISSUE_NEEDS,
  type IssueNeed,
  QUEUE_STATUSES,
  type QueueStatus,
} from "./fields.ts"

const SETTLED: GovernmentStatus[] = ["confirmed_resolved", "closed"]
export const ISSUE_LIST_LIMIT = 100

// Latest referral deadline before today
function overdue(today: string): SQL {
  return sql`${issues.govStatus} = 'awaiting_response' AND (
    SELECT r.deadline_on FROM referrals r
    WHERE r.org_id = ${issues.orgId} AND r.issue_id = ${issues.id}
      AND r.kind = 'referral'
    ORDER BY r.sent_on DESC, r.created_at DESC LIMIT 1
  ) < ${today}::date`
}

function needFilter(need: IssueNeed, today: string): SQL | undefined {
  const published = isNotNull(issues.publishedAt)
  switch (need) {
    case "belum-diteruskan":
      return and(
        published,
        eq(issues.advocacyStatus, "monitoring"),
        notInArray(issues.govStatus, SETTLED),
      )
    case "lewat-tenggat":
      return and(published, overdue(today))
  }
}

export type ManageSummary = {
  counts: Record<QueueStatus, number>
  needs: Record<IssueNeed, number>
}

/** Counts only, never report text. */
export function readManageSummary(
  orgId: string,
  role: MemberRole,
  now: Date,
): Promise<ManageSummary> {
  const today = jakartaIsoDate(now)
  return withTenant(
    orgId,
    async (tx) => {
      const byStatus = await tx
        .select({ status: reports.status, n: count() })
        .from(reports)
        .groupBy(reports.status)
      const counts = Object.fromEntries(
        QUEUE_STATUSES.map((status) => [
          status,
          byStatus.find((row) => row.status === status)?.n ?? 0,
        ]),
      ) as Record<QueueStatus, number>
      const needs = {} as Record<IssueNeed, number>
      for (const need of ISSUE_NEEDS) {
        const [row] = await tx
          .select({ n: count() })
          .from(issues)
          .where(needFilter(need, today))
        needs[need] = row?.n ?? 0
      }
      return {
        counts,
        needs,
      }
    },
    { role },
  )
}

export type ManagedIssueRow = {
  code: string
  title: string
  published: boolean
  takenDown: boolean
  advocacyStatus: AdvocacyStatus
  govStatus: GovernmentStatus
  verificationLabel: VerificationLabel
  reportCount: number
  lastActivityAt: Date
}

/** Staff list, drafts included. */
/** Same stages as Jelajah. */
function stageFilter(stage: PublicStage): SQL | undefined {
  const gov = inArray(issues.govStatus, [...STAGE_GOVERNMENT[stage]])
  if (stage === "verified") {
    return and(gov, eq(issues.advocacyStatus, "monitoring"))
  }
  if (stage === "referred") {
    return and(gov, ne(issues.advocacyStatus, "monitoring"))
  }
  return gov
}

export function listManagedIssues(
  orgId: string,
  role: MemberRole,
  need: IssueNeed | null,
  now: Date,
  stage: PublicStage | null = null,
): Promise<ManagedIssueRow[]> {
  return withTenant(
    orgId,
    (tx) =>
      tx
        .select({
          code: issues.publicCode,
          title: issues.title,
          published: sql<boolean>`${issues.publishedAt} IS NOT NULL`,
          takenDown: sql<boolean>`${issues.takenDownAt} IS NOT NULL`,
          advocacyStatus: issues.advocacyStatus,
          govStatus: issues.govStatus,
          verificationLabel: issues.verificationLabel,
          reportCount: issues.reportCount,
          lastActivityAt: issues.lastActivityAt,
        })
        .from(issues)
        .where(
          and(
            need ? needFilter(need, jakartaIsoDate(now)) : undefined,
            stage ? stageFilter(stage) : undefined,
          ),
        )
        .orderBy(desc(issues.lastActivityAt), desc(issues.id))
        .limit(ISSUE_LIST_LIMIT),
    { role },
  )
}
