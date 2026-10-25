import { and, desc, eq, inArray, ne } from "drizzle-orm"
import { type Db, database } from "../../../db/client.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { sessions } from "../../../db/schema/auth.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import { isFresh } from "../moderation/step-up.server.ts"

export type ActiveSession = {
  id: string
  createdAt: Date
  // Device hint, never the IP
  userAgent: string | null
  current: boolean
}

/** ASVS V7.5.2: own sessions, newest. */
export async function listSessions(
  userId: string,
  currentSessionId: string,
  db: Db = database().db,
): Promise<ActiveSession[]> {
  const rows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
  return rows.map((row) => ({ ...row, current: row.id === currentSessionId }))
}

type Revoked = { ok: true; ended: number } | { ok: false; reason: "stale" }

/** Others or chosen, after re-authentication. */
export async function revokeSessions(
  input: {
    orgId: string
    userId: string
    currentSessionId: string
    which: "others" | readonly string[]
  },
  db: Db = database().db,
): Promise<Revoked> {
  if (!(await isFresh(input.currentSessionId, db))) {
    return { ok: false, reason: "stale" }
  }
  const own = eq(sessions.userId, input.userId)
  const target =
    input.which === "others"
      ? and(own, ne(sessions.id, input.currentSessionId))
      : and(own, inArray(sessions.id, [...input.which]))
  const ended = await db
    .delete(sessions)
    .where(target)
    .returning({ id: sessions.id })
  await withTenant(input.orgId, (tx) =>
    tx.insert(auditLog).values({
      orgId: input.orgId,
      actorId: input.userId,
      action: "session.revoke",
      entityType: "user",
      entityId: input.userId,
      changedColumns: ["sessions"],
    }),
  )
  return { ok: true, ended: ended.length }
}
