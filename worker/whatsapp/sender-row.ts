import { sql } from "drizzle-orm"
import type { Db } from "../../db/client.server.ts"
import { whatsappSender } from "../../db/schema/whatsapp.ts"
import type { WhatsAppRequest } from "../../shared/whatsapp.ts"

export type SenderPatch = Partial<
  Omit<typeof whatsappSender.$inferInsert, "id" | "provider">
>

/** Upsert the single row. */
export async function updateSender(
  db: Db,
  provider: string,
  patch: SenderPatch,
): Promise<void> {
  const set = { ...patch, provider, updatedAt: new Date() }
  await db
    .insert(whatsappSender)
    .values({ id: 1, status: "unlinked", ...set })
    .onConflictDoUpdate({ target: whatsappSender.id, set })
}

/** Stored fault code, if any. */
export async function senderFault(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ lastError: whatsappSender.lastError })
    .from(whatsappSender)
    .where(sql`${whatsappSender.id} = 1`)
  return row?.lastError ?? null
}

export type TakenRequest = {
  requested: WhatsAppRequest
  pairingPhone: string | null
}

/** Claims the pending /admin request. */
export async function takeRequest(db: Db): Promise<TakenRequest | null> {
  const { rows } = await db.execute<{
    requested: WhatsAppRequest
    pairing_phone: string | null
  }>(sql`
    UPDATE whatsapp_sender s SET requested = NULL
    FROM (SELECT requested, pairing_phone FROM whatsapp_sender
      WHERE id = 1 AND requested IS NOT NULL FOR UPDATE) old
    WHERE s.id = 1
    RETURNING old.requested, old.pairing_phone`)
  const row = rows[0]
  return row
    ? { requested: row.requested, pairingPhone: row.pairing_phone }
    : null
}

export async function heartbeat(db: Db): Promise<void> {
  await db
    .update(whatsappSender)
    .set({ lastSeenAt: new Date() })
    .where(sql`${whatsappSender.id} = 1`)
}
