import { and, eq, isNull } from "drizzle-orm"
import { redirect } from "react-router"
import { type Db, database } from "../../../db/client.server.ts"
import { sessions, users } from "../../../db/schema/auth.ts"
import { pgError } from "../../../db/tenant.server.ts"
import { normalizePhone } from "../../../shared/phone.ts"
import { FRESH_SESSION } from "../moderation/step-up.server.ts"

export type AddPhoneError = "format" | "taken" | "pending" | "exists"

/** ASVS V7.5.1: re-authenticate first. */
async function requireFreshSession(
  db: Db,
  userId: string,
  sessionId: string | undefined,
): Promise<void> {
  const own = eq(sessions.userId, userId)
  const scope = sessionId ? and(own, eq(sessions.id, sessionId)) : own
  const [fresh] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(scope, FRESH_SESSION))
    .limit(1)
  if (fresh) return
  // Possibly stolen: end it
  await db.delete(sessions).where(scope)
  throw redirect("/masuk", 303)
}

/** Phoneless account, unproven number. */
export async function addPhone(
  userId: string,
  input: string,
  db: Db = database().db,
  // Exact binding, else any session
  sessionId?: string,
): Promise<{ ok: true } | { ok: false; error: AddPhoneError }> {
  const phone = normalizePhone(input)
  if (!phone) return { ok: false, error: "format" }
  await requireFreshSession(db, userId, sessionId)
  const [holder] = await db
    .select({ verified: users.phoneVerified })
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1)
  if (holder) return { ok: false, error: holder.verified ? "taken" : "pending" }
  try {
    // updated_at kept: no staff sign-out
    const updated = await db
      .update(users)
      .set({ phoneNumber: phone, phoneVerified: false })
      .where(and(eq(users.id, userId), isNull(users.phoneNumber)))
      .returning({ id: users.id })
    return updated.length > 0 ? { ok: true } : { ok: false, error: "exists" }
  } catch (error) {
    // Taken since the check
    if (pgError(error)?.code === "23505") return { ok: false, error: "taken" }
    throw error
  }
}
