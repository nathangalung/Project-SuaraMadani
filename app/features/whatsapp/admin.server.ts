import { encode } from "uqr"
import { type Db, database } from "../../../db/client.server.ts"
import { whatsappSender } from "../../../db/schema/whatsapp.ts"
import { writeLog } from "../../../server/log.ts"
import { normalizePhone } from "../../../shared/phone.ts"
import {
  WHATSAPP_FRESH_MS,
  type WhatsAppRequest,
  type WhatsAppStatus,
  whatsappReady,
} from "../../../shared/whatsapp.ts"

export type QrPath = { size: number; path: string }

/** Dark modules as SVG path. */
export function qrPath(text: string): QrPath {
  const { data, size } = encode(text, { ecc: "L", border: 1 })
  const parts: string[] = []
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`)
    })
  })
  return { size, path: parts.join("") }
}

export type SenderView = {
  provider: string | null
  status: WhatsAppStatus
  // Worker heartbeat is fresh
  running: boolean
  ready: boolean
  linkedPhone: string | null
  lastConnectedAt: Date | null
  lastError: string | null
  qr: QrPath | null
  pairingCode: string | null
  // Request not yet claimed
  pending: boolean
}

export async function readSender(
  now: Date,
  db: Db = database().db,
): Promise<SenderView> {
  const [row] = await db.select().from(whatsappSender).limit(1)
  const seen = row?.lastSeenAt ?? null
  const running =
    seen !== null && now.getTime() - seen.getTime() <= WHATSAPP_FRESH_MS
  const linking = row?.status === "linking"
  return {
    provider: row?.provider ?? null,
    status: row?.status ?? "unlinked",
    running,
    ready: whatsappReady(row, now),
    linkedPhone: row?.linkedPhone ?? null,
    lastConnectedAt: row?.lastConnectedAt ?? null,
    lastError: row?.lastError ?? null,
    qr: linking && row?.qr ? qrPath(row.qr) : null,
    pairingCode: linking ? (row?.pairingCode ?? null) : null,
    pending: row?.requested != null,
  }
}

export type SenderIntent = WhatsAppRequest

export function isSenderIntent(value: unknown): value is SenderIntent {
  return value === "link_qr" || value === "link_code" || value === "unlink"
}

/** Worker claims it within seconds. */
export async function requestSender(
  input: { intent: SenderIntent; phone?: string; actorId: string },
  db: Db = database().db,
): Promise<{ ok: true } | { ok: false; error: "phone" }> {
  const pairingPhone =
    input.intent === "link_code" ? normalizePhone(input.phone ?? "") : null
  if (input.intent === "link_code" && !pairingPhone) {
    return { ok: false, error: "phone" }
  }
  const set = {
    requested: input.intent,
    requestedBy: input.actorId,
    pairingPhone,
    updatedAt: new Date(),
  }
  await db
    .insert(whatsappSender)
    .values({ id: 1, provider: "baileys", status: "unlinked", ...set })
    .onConflictDoUpdate({ target: whatsappSender.id, set })
  // Platform action, no tenant audit
  writeLog({
    msg: "whatsapp sender request",
    request: input.intent,
    actor: input.actorId,
  })
  return { ok: true }
}
