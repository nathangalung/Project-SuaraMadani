import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { demandFollows, demands } from "../../../db/schema/demands.ts"
import { issues } from "../../../db/schema/issues.ts"
import { follows } from "../../../db/schema/notifications.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import type { FulfilmentStatus, IssueState } from "../../../shared/status.ts"

// Enough for one page
const FOLLOWED_LIMIT = 50

type FollowedIssue = {
  code: string
  title: string
  state: IssueState
  updatedAt: Date
}

type FollowedDemand = {
  code: string
  title: string
  progress: FulfilmentStatus
  updatedAt: Date
}

export type Followed = { issues: FollowedIssue[]; demands: FollowedDemand[] }

/** Public items this user follows. */
export function listFollowed(orgId: string, userId: string): Promise<Followed> {
  return withTenant(
    orgId,
    async (tx) => {
      const issueRows = await tx
        .select({
          code: issues.publicCode,
          title: issues.title,
          advocacy: issues.advocacyStatus,
          government: issues.govStatus,
          updatedAt: issues.lastActivityAt,
        })
        .from(follows)
        .innerJoin(issues, eq(issues.id, follows.issueId))
        .where(
          and(
            eq(follows.userId, userId),
            isNotNull(issues.publishedAt),
            isNull(issues.takenDownAt),
          ),
        )
        .orderBy(desc(issues.lastActivityAt))
        .limit(FOLLOWED_LIMIT)
      const demandRows = await tx
        .select({
          code: demands.publicCode,
          title: demands.title,
          progress: demands.progress,
          updatedAt: demands.lastActivityAt,
        })
        .from(demandFollows)
        .innerJoin(demands, eq(demands.id, demandFollows.demandId))
        .where(
          and(
            eq(demandFollows.userId, userId),
            isNotNull(demands.publishedAt),
            isNull(demands.hiddenAt),
          ),
        )
        .orderBy(desc(demands.lastActivityAt))
        .limit(FOLLOWED_LIMIT)
      return {
        issues: issueRows.map(({ advocacy, government, ...row }) => ({
          ...row,
          state: { advocacy, government },
        })),
        demands: demandRows,
      }
    },
    { role: "reporter" },
  )
}
