import { and, count, eq, gte, isNull, max, ne, or, sql } from "drizzle-orm"
import type { Db } from "../db/client.server.ts"
import { sendJob } from "../db/jobs.server.ts"
import { whatsappLog, whatsappSender } from "../db/schema/whatsapp.ts"
import {
  OTP_TTL_SECONDS,
  type OtpPurpose,
  WHATSAPP_FRESH_MS,
  WHATSAPP_LIMITS,
  type WhatsAppLogStatus,
  whatsappReady,
} from "../shared/whatsapp.ts"
import { clientKey } from "./api/upload.server.ts"
import { addressHash } from "./email-log.ts"
import { seal } from "./seal.ts"

// Separate lock from email
const WHATSAPP_LOCK = 0x5e4d_a12

type WhatsAppRefusal = "unavailable" | "spacing" | "daily" | "busy"

// Unproven number carries the client
type SendPurpose =
  | { purpose: "sign-in" }
  | { purpose: "sign-up"; client: string | null }

export type WhatsAppGateway = {
  ready: () => Promise<boolean>
  sendCode: (
    to: string,
    code: string,
    purpose?: SendPurpose,
  ) => Promise<
    { ok: true; logId: string } | { ok: false; reason: WhatsAppRefusal }
  >
  status: (logId: string) => Promise<WhatsAppLogStatus | null>
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

type Scope = {
  phoneHash?: string
  purpose?: OtpPurpose
  clientHash?: string
}

// Socket down: WhatsApp never asked
const ASKED = or(
  isNull(whatsappLog.error),
  ne(whatsappLog.error, "unavailable"),
)

/** Requester caps count every row. */
async function sentSince(
  tx: Tx,
  since: Date,
  scope: Scope = {},
): Promise<{ n: number; last: Date | null }> {
  const requester = Boolean(scope.phoneHash || scope.clientHash)
  const [row] = await tx
    .select({ n: count(), last: max(whatsappLog.createdAt) })
    .from(whatsappLog)
    .where(
      and(
        scope.phoneHash
          ? eq(whatsappLog.phoneHash, scope.phoneHash)
          : undefined,
        scope.purpose ? eq(whatsappLog.purpose, scope.purpose) : undefined,
        scope.clientHash
          ? eq(whatsappLog.clientHash, scope.clientHash)
          : undefined,
        requester ? undefined : ASKED,
        gte(whatsappLog.createdAt, since),
      ),
    )
  return { n: row?.n ?? 0, last: row?.last ? new Date(row.last) : null }
}

/** Daftar share, then per client. */
async function signUpRefusal(
  tx: Tx,
  clientHash: string | null,
  now: Date,
): Promise<WhatsAppRefusal | null> {
  const day = new Date(now.getTime() - 86_400_000)
  const hour = new Date(now.getTime() - 3_600_000)
  const purpose = "sign_up"
  if (
    (await sentSince(tx, hour, { purpose })).n >= WHATSAPP_LIMITS.signUpPerHour
  )
    return "busy"
  if ((await sentSince(tx, day, { purpose })).n >= WHATSAPP_LIMITS.signUpPerDay)
    return "busy"
  if (!clientHash) return null
  const own = await sentSince(tx, day, { purpose, clientHash })
  return own.n >= WHATSAPP_LIMITS.signUpPerClientDay ? "busy" : null
}

/** Per number, then whole sender. */
async function refusal(
  tx: Tx,
  phoneHash: string,
  now: Date,
): Promise<WhatsAppRefusal | null> {
  const day = new Date(now.getTime() - 86_400_000)
  const own = await sentSince(tx, day, { phoneHash })
  if (
    own.last &&
    now.getTime() - own.last.getTime() < WHATSAPP_LIMITS.spacingMs
  ) {
    return "spacing"
  }
  if (own.n >= WHATSAPP_LIMITS.perDay) return "daily"
  const hour = await sentSince(tx, new Date(now.getTime() - 3_600_000))
  if (hour.n >= WHATSAPP_LIMITS.perHour) return "busy"
  const total = await sentSince(tx, day)
  return total.n >= WHATSAPP_LIMITS.perDayTotal ? "busy" : null
}

export function createWhatsAppGateway(deps: {
  db: Db
  hashKey: () => Buffer
  jobKey: () => Buffer
  // Off in dev, like email
  caps: boolean
  now?: () => Date
}): WhatsAppGateway {
  const now = deps.now ?? (() => new Date())
  const ready = async () => {
    const [row] = await deps.db
      .select({
        status: whatsappSender.status,
        lastSeenAt: whatsappSender.lastSeenAt,
      })
      .from(whatsappSender)
      .limit(1)
    return whatsappReady(row, now())
  }
  return {
    ready,
    async sendCode(to, code, purpose = { purpose: "sign-in" }) {
      if (!(await ready())) return { ok: false, reason: "unavailable" }
      const at = now()
      const phoneHash = addressHash(to, deps.hashKey())
      const signUp = purpose.purpose === "sign-up"
      const client = signUp ? clientKey(purpose.client) : "unknown"
      const clientHash =
        client === "unknown" ? null : addressHash(client, deps.hashKey())
      return deps.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${WHATSAPP_LOCK})`)
        const refused = !deps.caps
          ? null
          : ((await refusal(tx, phoneHash, at)) ??
            (signUp ? await signUpRefusal(tx, clientHash, at) : null))
        if (refused) return { ok: false, reason: refused } as const
        const [row] = await tx
          .insert(whatsappLog)
          .values({
            phoneHash,
            status: "reserved",
            purpose: signUp ? "sign_up" : "sign_in",
            clientHash,
            createdAt: at,
          })
          .returning({ id: whatsappLog.id })
        if (!row) throw new Error("whatsapp_log not inserted")
        const expiresAt = at.getTime() + OTP_TTL_SECONDS * 1000
        // Outbox: commits with the row
        await sendJob(tx, "whatsapp-send", {
          logId: row.id,
          sealed: seal({ to, code, expiresAt }, deps.jobKey(), "job"),
        })
        return { ok: true, logId: row.id } as const
      })
    },
    async status(logId) {
      const [row] = await deps.db
        .select({
          status: whatsappLog.status,
          createdAt: whatsappLog.createdAt,
        })
        .from(whatsappLog)
        .where(eq(whatsappLog.id, logId))
        .limit(1)
      if (!row) return null
      // Worker gone or hung
      const age = now().getTime() - row.createdAt.getTime()
      return row.status === "reserved" && age > WHATSAPP_FRESH_MS
        ? "failed"
        : row.status
    },
  }
}
