import { and, eq, isNull } from "drizzle-orm"
import { type Db, database } from "../../../db/client.server.ts"
import { users } from "../../../db/schema/auth.ts"
import { pgError } from "../../../db/tenant.server.ts"
import { normalizePhone } from "../../../shared/phone.ts"

export type AddPhoneError = "format" | "taken" | "pending" | "exists"

/** Phoneless account, unproven number. */
export async function addPhone(
  userId: string,
  input: string,
  db: Db = database().db,
): Promise<{ ok: true } | { ok: false; error: AddPhoneError }> {
  const phone = normalizePhone(input)
  if (!phone) return { ok: false, error: "format" }
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
