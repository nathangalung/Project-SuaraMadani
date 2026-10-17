import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { members } from "../../../db/schema/auth.ts"
import { issues } from "../../../db/schema/issues.ts"
import { follows } from "../../../db/schema/notifications.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"

async function publishedId(tx: Tx, code: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.publicCode, code), isNotNull(issues.publishedAt)))
    .limit(1)
  return row?.id ?? null
}

/** False: unknown or unpublished. */
export function followIssue(
  orgId: string,
  code: string,
  userId: string,
): Promise<boolean> {
  return withTenant(
    orgId,
    async (tx) => {
      const issueId = await publishedId(tx, code)
      if (!issueId) return false
      // Notifications need a membership
      await tx
        .insert(members)
        .values({ organizationId: orgId, userId, role: "reporter" })
        .onConflictDoNothing({
          target: [members.organizationId, members.userId],
        })
      await tx
        .insert(follows)
        .values({ orgId, issueId, userId })
        .onConflictDoNothing()
      return true
    },
    { role: "reporter" },
  )
}

export function unfollowIssue(
  orgId: string,
  code: string,
  userId: string,
): Promise<void> {
  return withTenant(
    orgId,
    async (tx) => {
      const ids = tx
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.publicCode, code))
      await tx
        .delete(follows)
        .where(and(inArray(follows.issueId, ids), eq(follows.userId, userId)))
    },
    { role: "reporter" },
  )
}

export function isFollowing(
  orgId: string,
  code: string,
  userId: string,
): Promise<boolean> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({ userId: follows.userId })
      .from(follows)
      .innerJoin(
        issues,
        and(eq(issues.orgId, follows.orgId), eq(issues.id, follows.issueId)),
      )
      .where(and(eq(issues.publicCode, code), eq(follows.userId, userId)))
      .limit(1)
    return row !== undefined
  })
}

export type UnfollowTarget = {
  issueId: string
  code: string
  title: string
  following: boolean
}

/** Signed unsubscribe page data. */
export function unfollowTarget(
  orgId: string,
  issueId: string,
  userId: string,
): Promise<UnfollowTarget | null> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({
        code: issues.publicCode,
        title: issues.title,
        following: follows.userId,
      })
      .from(issues)
      .leftJoin(
        follows,
        and(
          eq(follows.orgId, issues.orgId),
          eq(follows.issueId, issues.id),
          eq(follows.userId, userId),
        ),
      )
      .where(and(eq(issues.id, issueId), isNotNull(issues.publishedAt)))
      .limit(1)
    if (!row) return null
    return {
      issueId,
      code: row.code,
      title: row.title,
      following: row.following !== null,
    }
  })
}
