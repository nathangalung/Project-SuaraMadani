import { createHmac } from "node:crypto"
import { and, count, eq, gte, inArray, max, sql } from "drizzle-orm"
import type { Db } from "../db/client.server.ts"
import { type EmailKind, emailLog } from "../db/schema/notifications.ts"
import { EMAIL_QUOTA, jakartaDayStart } from "../shared/notifications.ts"
import type { EmailMessage, EmailSender } from "./email.ts"
import { errorRecord, writeLog } from "./log.ts"

const MIN_KEY_BYTES = 32

/** AUDIT_HMAC_KEY, base64, 32 bytes. */
export function parseHashKey(value: string | undefined): Buffer {
  if (!value?.trim()) throw new Error("AUDIT_HMAC_KEY is not set")
  const key = Buffer.from(value.trim(), "base64")
  if (key.length < MIN_KEY_BYTES) {
    throw new Error("AUDIT_HMAC_KEY needs 32 bytes")
  }
  return key
}

let envKey: Buffer | undefined

export function hashKey(): Buffer {
  envKey ??= parseHashKey(process.env.AUDIT_HMAC_KEY)
  return envKey
}

/** No dictionary reversal without key. */
export function addressHash(address: string, key: Buffer): string {
  return createHmac("sha256", key)
    .update(address.trim().toLowerCase())
    .digest("hex")
}

/** Audit value hash, never text. */
export function valueHash(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(value).digest("hex")
}

// One global lock, quota counts
export const EMAIL_QUOTA_LOCK = 0x5e4d_a11

// Starting Values: per address
const OTP_LIMITS = { spacingMs: 60_000, perDay: 8 } as const
// Daftar or first proof
const UNPROVEN_OTP_LIMITS = { spacingMs: 60_000, perDay: 3 } as const
const INVITATION_LIMITS = { spacingMs: 60_000, perDay: 5 } as const

type Limits = { spacingMs: number; perDay: number }
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export type EmailReservation =
  | { ok: true; logId: string }
  | { ok: false; reason: "spacing" | "daily" | "quota" }

export type OtpReservation =
  | EmailReservation
  // Daftar share or client cap
  | { ok: false; reason: "busy" }

type OtpOptions = {
  // Address the account never proved
  unproven?: boolean
  // HMAC of clientKey, Daftar only
  client?: string | null
}

/** Spacing and 24 h count. */
async function ownLimit(
  tx: Tx,
  kind: EmailKind,
  hash: string,
  limits: Limits,
  now: Date,
): Promise<"spacing" | "daily" | null> {
  const since = new Date(now.getTime() - 86_400_000)
  const [own] = await tx
    .select({ n: count(), last: max(emailLog.createdAt) })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.kind, kind),
        eq(emailLog.addressHash, hash),
        gte(emailLog.createdAt, since),
      ),
    )
  const last = own?.last ? new Date(own.last).getTime() : null
  if (last !== null && now.getTime() - last < limits.spacingMs) {
    return "spacing"
  }
  return (own?.n ?? 0) >= limits.perDay ? "daily" : null
}

/** Today's reserved or sent rows. */
export async function usedToday(
  tx: Tx,
  now: Date,
  kinds?: readonly EmailKind[],
): Promise<number> {
  const [used] = await tx
    .select({ n: count() })
    .from(emailLog)
    .where(
      and(
        kinds ? inArray(emailLog.kind, [...kinds]) : undefined,
        inArray(emailLog.status, ["reserved", "sent"]),
        gte(emailLog.createdAt, jakartaDayStart(now)),
      ),
    )
  return used?.n ?? 0
}

async function reserveRow(
  tx: Tx,
  values: Pick<typeof emailLog.$inferInsert, "kind" | "addressHash"> &
    Partial<typeof emailLog.$inferInsert>,
): Promise<string> {
  const [row] = await tx
    .insert(emailLog)
    .values({ ...values, status: "reserved" })
    .returning({ id: emailLog.id })
  if (!row) throw new Error("email_log not inserted")
  return row.id
}

/** Unproven codes since, optional client. */
async function signUpsSince(
  tx: Tx,
  since: Date,
  client?: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.kind, "otp"),
        eq(emailLog.purpose, "sign_up"),
        client ? eq(emailLog.clientHash, client) : undefined,
        inArray(emailLog.status, ["reserved", "sent"]),
        gte(emailLog.createdAt, since),
      ),
    )
  return row?.n ?? 0
}

/** Share per hour, day, client. */
async function signUpBusy(
  tx: Tx,
  client: string | null,
  now: Date,
): Promise<boolean> {
  const hour = new Date(now.getTime() - 3_600_000)
  const day = new Date(now.getTime() - 86_400_000)
  if ((await signUpsSince(tx, hour)) >= EMAIL_QUOTA.signUpPerHour) return true
  if ((await signUpsSince(tx, day)) >= EMAIL_QUOTA.signUpPerDay) return true
  if (!client) return false
  return (await signUpsSince(tx, day, client)) >= EMAIL_QUOTA.signUpPerClientDay
}

/** Checks caps, reserves a slot. */
export function reserveOtp(
  db: Db,
  hash: string,
  now = new Date(),
  options: OtpOptions = {},
): Promise<OtpReservation> {
  const unproven = options.unproven === true
  const limits = unproven ? UNPROVEN_OTP_LIMITS : OTP_LIMITS
  const client = unproven ? (options.client ?? null) : null
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${EMAIL_QUOTA_LOCK})`)
    const own = await ownLimit(tx, "otp", hash, limits, now)
    if (own) return { ok: false, reason: own }
    if (unproven && (await signUpBusy(tx, client, now))) {
      writeLog({ msg: "email sign-up share full" })
      return { ok: false, reason: "busy" }
    }
    if ((await usedToday(tx, now)) >= EMAIL_QUOTA.providerDaily) {
      return { ok: false, reason: "quota" }
    }
    const logId = await reserveRow(tx, {
      kind: "otp",
      addressHash: hash,
      purpose: unproven ? "sign_up" : "sign_in",
      clientHash: client,
      createdAt: now,
    })
    return { ok: true, logId }
  })
}

/** Never touches the OTP reserve. */
export function reserveInvitation(
  db: Db,
  hash: string,
  now = new Date(),
): Promise<EmailReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${EMAIL_QUOTA_LOCK})`)
    const own = await ownLimit(tx, "invitation", hash, INVITATION_LIMITS, now)
    if (own) return { ok: false, reason: own }
    const invited = await usedToday(tx, now, ["invitation"])
    const shared = await usedToday(tx, now, ["notification", "invitation"])
    if (
      invited >= EMAIL_QUOTA.invitationDaily ||
      shared >= EMAIL_QUOTA.notificationCeiling ||
      (await usedToday(tx, now)) >= EMAIL_QUOTA.providerDaily
    ) {
      return { ok: false, reason: "quota" }
    }
    const logId = await reserveRow(tx, {
      kind: "invitation",
      addressHash: hash,
      createdAt: now,
    })
    return { ok: true, logId }
  })
}

/** Counted in email_log, best effort. */
export async function sendLogged(
  db: Db,
  input: {
    kind: EmailKind
    message: EmailMessage
    email: EmailSender
    // Lazy: missing key still sends
    key: () => Buffer
    // Row reserved earlier, reserveOtp
    logId?: string
  },
): Promise<void> {
  let logId = input.logId
  if (!logId) {
    try {
      const [row] = await db
        .insert(emailLog)
        .values({
          kind: input.kind,
          addressHash: addressHash(input.message.to, input.key()),
          status: "reserved",
        })
        .returning({ id: emailLog.id })
      logId = row?.id
    } catch (error) {
      // Sending never waits on logging
      writeLog({ msg: "email_log insert failed", ...errorRecord(error) })
    }
  }
  const mark = async (status: "sent" | "failed") => {
    if (!logId) return
    await db
      .update(emailLog)
      .set({ status, sentAt: status === "sent" ? new Date() : null })
      .where(eq(emailLog.id, logId))
  }
  try {
    await input.email.send(input.message)
  } catch (error) {
    await mark("failed")
    throw error
  }
  await mark("sent")
}
