import { and, eq, inArray, ne } from "drizzle-orm"
import { members } from "../../../db/schema/auth.ts"
import { demandFollows, demands } from "../../../db/schema/demands.ts"
import { withTenant } from "../../../db/tenant.server.ts"

/** False: unknown or draft. */
export function followDemand(
  orgId: string,
  code: string,
  userId: string,
): Promise<boolean> {
  return withTenant(
    orgId,
    async (tx) => {
      const [demand] = await tx
        .select({ id: demands.id })
        .from(demands)
        .where(and(eq(demands.publicCode, code), ne(demands.state, "draft")))
      if (!demand) return false
      // Notifications need a membership
      await tx
        .insert(members)
        .values({ organizationId: orgId, userId, role: "reporter" })
        .onConflictDoNothing({
          target: [members.organizationId, members.userId],
        })
      await tx
        .insert(demandFollows)
        .values({ orgId, demandId: demand.id, userId })
        .onConflictDoNothing()
      return true
    },
    { role: "reporter" },
  )
}

export function unfollowDemand(
  orgId: string,
  code: string,
  userId: string,
): Promise<void> {
  return withTenant(
    orgId,
    async (tx) => {
      const ids = tx
        .select({ id: demands.id })
        .from(demands)
        .where(eq(demands.publicCode, code))
      await tx
        .delete(demandFollows)
        .where(
          and(
            inArray(demandFollows.demandId, ids),
            eq(demandFollows.userId, userId),
          ),
        )
    },
    { role: "reporter" },
  )
}

export function isFollowingDemand(
  orgId: string,
  code: string,
  userId: string,
): Promise<boolean> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({ userId: demandFollows.userId })
      .from(demandFollows)
      .innerJoin(
        demands,
        and(
          eq(demands.orgId, demandFollows.orgId),
          eq(demands.id, demandFollows.demandId),
        ),
      )
      .where(
        and(eq(demands.publicCode, code), eq(demandFollows.userId, userId)),
      )
      .limit(1)
    return row !== undefined
  })
}

export type DemandUnfollowTarget = {
  code: string
  title: string
  following: boolean
}

/** Signed unsubscribe page data. */
export function demandUnfollowTarget(
  orgId: string,
  demandId: string,
  userId: string,
): Promise<DemandUnfollowTarget | null> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({
        code: demands.publicCode,
        title: demands.title,
        following: demandFollows.userId,
      })
      .from(demands)
      .leftJoin(
        demandFollows,
        and(
          eq(demandFollows.orgId, demands.orgId),
          eq(demandFollows.demandId, demands.id),
          eq(demandFollows.userId, userId),
        ),
      )
      .where(and(eq(demands.id, demandId), ne(demands.state, "draft")))
      .limit(1)
    if (!row) return null
    return {
      code: row.code,
      title: row.title,
      following: row.following !== null,
    }
  })
}
