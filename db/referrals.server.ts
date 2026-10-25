import { and, asc, eq, isNotNull, type SQL, sql } from "drizzle-orm"
import { issues, referrals } from "./schema/issues.ts"
import type { Tx } from "./tenant.server.ts"

// Newest referral, not escalation
const LATEST_REFERRAL = sql`(
  SELECT r.id FROM referrals r
  WHERE r.org_id = ${issues.orgId} AND r.issue_id = ${issues.id}
    AND r.kind = 'referral'
  ORDER BY r.sent_on DESC, r.created_at DESC LIMIT 1
)`

/** Lewat tenggat: /kelola and digest. */
export function overdueIssue(today: string): SQL {
  return sql`${issues.govStatus} = 'awaiting_response' AND (
    SELECT r.deadline_on FROM referrals r WHERE r.id = ${LATEST_REFERRAL}
  ) < ${today}::date`
}

export type OverdueReferral = {
  code: string
  title: string
  agency: string
  sentOn: string
  deadlineOn: string
}

/** Published only, oldest deadline first. */
export async function listOverdueReferrals(
  tx: Tx,
  today: string,
): Promise<OverdueReferral[]> {
  const rows = await tx
    .select({
      code: issues.publicCode,
      title: issues.title,
      agency: referrals.agency,
      sentOn: referrals.sentOn,
      deadlineOn: referrals.deadlineOn,
    })
    .from(issues)
    .innerJoin(
      referrals,
      and(
        eq(referrals.orgId, issues.orgId),
        eq(referrals.issueId, issues.id),
        sql`${referrals.id} = ${LATEST_REFERRAL}`,
      ),
    )
    .where(and(isNotNull(issues.publishedAt), overdueIssue(today)))
    .orderBy(asc(referrals.deadlineOn), asc(issues.publicCode))
  return rows.flatMap((row) =>
    row.deadlineOn ? [{ ...row, deadlineOn: row.deadlineOn }] : [],
  )
}
