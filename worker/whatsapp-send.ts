import { eq } from "drizzle-orm"
import type { Db } from "../db/client.server.ts"
import type { JobPayloads } from "../db/jobs.server.ts"
import { whatsappLog } from "../db/schema/whatsapp.ts"
import { openSealed } from "../server/seal.ts"
import { WHATSAPP_LIMITS, type WhatsAppLogError } from "../shared/whatsapp.ts"
import type { WhatsAppMessage, WhatsAppProvider } from "./whatsapp/provider.ts"

export type WhatsAppSendDeps = {
  db: Db
  jobKey: () => Buffer
  provider: WhatsAppProvider
  now: () => Date
  wait: (ms: number) => Promise<void>
}

type Outcome =
  | "sent"
  | "duplicate"
  | "expired"
  | "unreadable"
  | "not_on_whatsapp"
  | "unavailable"

type Sealed = WhatsAppMessage & { expiresAt: number }

function opened(sealed: string, key: Buffer): Sealed | null {
  try {
    const value = openSealed(sealed, key, "job") as Partial<Sealed>
    if (
      typeof value.to === "string" &&
      typeof value.code === "string" &&
      typeof value.expiresAt === "number"
    ) {
      return { to: value.to, code: value.code, expiresAt: value.expiresAt }
    }
  } catch {
    // Wrong key or tampered
  }
  return null
}

// Small random spread, less bot-like
function jitter(): number {
  return Math.floor(Math.random() * 1000)
}

/** One code per job, paced. */
export function createWhatsAppSendHandler(deps: WhatsAppSendDeps) {
  let lastSentAt = 0
  const mark = (
    logId: string,
    status: "sent" | "failed",
    error: WhatsAppLogError | null = null,
  ) =>
    deps.db
      .update(whatsappLog)
      .set({ status, error, sentAt: status === "sent" ? deps.now() : null })
      .where(eq(whatsappLog.id, logId))

  return async (
    { logId, sealed }: JobPayloads["whatsapp-send"],
    signal: AbortSignal,
  ): Promise<Outcome> => {
    const [row] = await deps.db
      .select({ status: whatsappLog.status })
      .from(whatsappLog)
      .where(eq(whatsappLog.id, logId))
      .limit(1)
    if (row?.status === "sent") return "duplicate"
    const message = opened(sealed, deps.jobKey())
    if (!message) {
      await mark(logId, "failed", "provider")
      return "unreadable"
    }
    if (message.expiresAt <= deps.now().getTime()) {
      await mark(logId, "failed", "expired")
      return "expired"
    }
    const since = deps.now().getTime() - lastSentAt
    if (lastSentAt > 0 && since < WHATSAPP_LIMITS.gapMs) {
      await deps.wait(WHATSAPP_LIMITS.gapMs - since + jitter())
    }
    let result: Awaited<ReturnType<WhatsAppProvider["send"]>>
    try {
      result = await deps.provider.send(
        { to: message.to, code: message.code },
        signal,
      )
    } catch (error) {
      // Browser offers email meanwhile
      await mark(logId, "failed", "provider")
      throw error
    }
    lastSentAt = deps.now().getTime()
    if (result === "sent") {
      await mark(logId, "sent")
      return "sent"
    }
    await mark(logId, "failed", result)
    return result
  }
}
