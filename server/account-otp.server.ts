import { createHash, timingSafeEqual } from "node:crypto"
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth"
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"
import * as z from "zod"
import {
  type Destination,
  identifierKind,
  isReleasedEmail,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhone,
  releasedEmail,
} from "../shared/phone.ts"
import { ageDeclarationSchema } from "../shared/report-schema.ts"
import {
  OTP_CHANNELS,
  OTP_TTL_SECONDS,
  type OtpChannel,
} from "../shared/whatsapp.ts"
import type { WhatsAppGateway } from "./whatsapp.server.ts"

export const ACCOUNT_PATHS = {
  lookup: "/account/lookup",
  checkNew: "/account/check-new",
  send: "/account/send-code",
  verify: "/account/verify-code",
  status: "/account/code-status",
} as const

const ALLOWED_ATTEMPTS = 3
const NAME = { min: 2, max: 100 } as const
// Letters, marks, spaces, name punctuation
const NAME_TEXT = /^[\p{L}\p{M}' .,-]+$/u

type User = {
  id: string
  email: string
  emailVerified: boolean
  phoneNumber?: string | null
  phoneVerified?: boolean | null
  twoFactorEnabled?: boolean | null
  updatedAt?: Date
}

// Reserve, then send the code
type EmailCodeSender = (
  to: string,
  // Client IP for per-client caps
  options: { unproven: boolean; client: string | null },
) => Promise<(code: string) => void>

export type AccountOtpDeps = {
  sendEmail: EmailCodeSender
  whatsapp: WhatsAppGateway
}

const channel = z.enum(OTP_CHANNELS)
const signIn = z.object({
  mode: z.literal("sign-in"),
  identifier: z.string().max(320),
  channel,
})
const signUp = z.object({
  mode: z.literal("sign-up"),
  name: z.string().max(200),
  email: z.string().max(320),
  phone: z.string().max(40),
  channel,
})
const sendBody = z.discriminatedUnion("mode", [signIn, signUp])
const code = z.string().regex(/^\d{6}$/)
const verifyBody = z.discriminatedUnion("mode", [
  signIn.extend({ code }),
  signUp.extend({ code, ageDeclaration: z.unknown().optional() }),
])

function refuse(
  status: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
  code: string,
): never {
  throw new APIError(status, { code, message: code })
}

function hashCode(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

function sameHash(stored: string, value: string): boolean {
  const a = Buffer.from(stored)
  const b = Buffer.from(hashCode(value))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Trimmed, single spaces, plain letters. */
function cleanName(input: string): string | null {
  const value = input.trim().replace(/\s+/g, " ")
  if (value.length < NAME.min || value.length > NAME.max) return null
  return NAME_TEXT.test(value) ? value : null
}

type Ctx = GenericEndpointContext

async function userByEmail(ctx: Ctx, email: string): Promise<User | null> {
  const found = await ctx.context.internalAdapter.findUserByEmail(email)
  return (found?.user as User | undefined) ?? null
}

async function userByPhone(ctx: Ctx, phone: string): Promise<User | null> {
  return ctx.context.adapter.findOne<User>({
    model: "user",
    where: [{ field: "phoneNumber", value: phone }],
  })
}

/** Holder, proven or not. */
async function holderOf(
  ctx: Ctx,
  identifier: string,
): Promise<{ user: User; proven: boolean } | null> {
  const parsed = identifierKind(identifier)
  if (!parsed) refuse("BAD_REQUEST", "INVALID_IDENTIFIER")
  const user =
    parsed.kind === "email"
      ? await userByEmail(ctx, parsed.value)
      : await userByPhone(ctx, parsed.value)
  if (!user) return null
  const proven =
    parsed.kind === "email" ? user.emailVerified : user.phoneVerified === true
  return { user, proven }
}

/** Proven identifiers sign in only. */
async function userFor(ctx: Ctx, identifier: string): Promise<User | null> {
  const found = await holderOf(ctx, identifier)
  return found?.proven ? found.user : null
}

const emailOf = (user: User) =>
  isReleasedEmail(user.email) ? null : user.email

type NewAccount = { name: string; email: string; phone: string }

function newAccount(body: z.infer<typeof signUp>): NewAccount {
  const name = cleanName(body.name)
  if (!name) refuse("BAD_REQUEST", "INVALID_NAME")
  const email = normalizeEmail(body.email)
  if (!email) refuse("BAD_REQUEST", "INVALID_EMAIL")
  const phone = normalizePhone(body.phone)
  if (!phone) refuse("BAD_REQUEST", "INVALID_PHONE")
  return { name, email, phone }
}

// Pending: unproven on another row
type Clash = {
  taken: "email" | "phone" | "pending" | null
  only: OtpChannel | null
  holders: { email: User | null; phone: User | null }
}

/** Proven elsewhere blocks, unproven moves. */
async function clashOf(ctx: Ctx, account: NewAccount): Promise<Clash> {
  const holders = {
    email: await userByEmail(ctx, account.email),
    phone: await userByPhone(ctx, account.phone),
  }
  const clash = (taken: Clash["taken"], only: OtpChannel | null = null) => ({
    taken,
    only,
    holders,
  })
  if (holders.email?.emailVerified) return clash("email")
  if (holders.phone?.phoneVerified) return clash("phone")
  if (holders.email && holders.phone) return clash("pending")
  if (holders.email) return clash(null, "email")
  return clash(null, holders.phone ? "whatsapp" : null)
}

const CLASH_CODE = {
  email: "EMAIL_TAKEN",
  phone: "PHONE_TAKEN",
  pending: "IDENTIFIERS_PENDING",
} as const

type Target = {
  key: string
  to: string
  user: User | null
  account: NewAccount | null
  // Unproven holder to release
  release: User | null
  // Destination never proven: Daftar caps
  unproven: boolean
}

/** Code bound to destination. */
async function targetOf(
  ctx: Ctx,
  body: z.infer<typeof sendBody>,
): Promise<Target> {
  if (body.mode === "sign-up") {
    const account = newAccount(body)
    const clash = await clashOf(ctx, account)
    if (clash.taken) refuse("CONFLICT", CLASH_CODE[clash.taken])
    // The other must be proven
    if (clash.only && clash.only !== body.channel) {
      refuse(
        "CONFLICT",
        clash.only === "email" ? "EMAIL_PENDING" : "PHONE_PENDING",
      )
    }
    const email = body.channel === "email"
    return {
      key: `account-otp:sign-up:${body.channel}:${account.email}|${account.phone}`,
      to: email ? account.email : account.phone,
      user: null,
      account,
      release: email ? clash.holders.email : clash.holders.phone,
      unproven: true,
    }
  }
  const user = await userFor(ctx, body.identifier)
  if (!user) refuse("NOT_FOUND", "ACCOUNT_NOT_FOUND")
  const email = body.channel === "email"
  const to = email ? emailOf(user) : user.phoneNumber
  if (!to) refuse("BAD_REQUEST", email ? "NO_EMAIL" : "NO_PHONE")
  return {
    // Destination changed: code void
    key: `account-otp:sign-in:${body.channel}:${user.id}:${to}`,
    to,
    user,
    account: null,
    release: null,
    unproven: email ? !user.emailVerified : user.phoneVerified !== true,
  }
}

/** Untyped identifier: presence only. */
function destination(
  value: string | null,
  typed: boolean,
  mask: (value: string) => string,
): Destination {
  if (!value) return null
  return typed ? { kind: "masked", value: mask(value) } : { kind: "registered" }
}

const masked = (channel: OtpChannel, to: string) =>
  channel === "email" ? maskEmail(to) : maskPhone(to)

/** Atomic consume, attempts kept. */
async function consumeCode(ctx: Ctx, key: string, value: string) {
  const row = await ctx.context.internalAdapter.consumeVerificationValue(key)
  if (!row) refuse("BAD_REQUEST", "INVALID_OTP")
  const at = row.value.lastIndexOf(":")
  const stored = row.value.slice(0, at)
  const attempts = Number(row.value.slice(at + 1)) || 0
  if (attempts >= ALLOWED_ATTEMPTS) refuse("FORBIDDEN", "TOO_MANY_ATTEMPTS")
  if (sameHash(stored, value)) return
  if (attempts + 1 < ALLOWED_ATTEMPTS) {
    await ctx.context.internalAdapter.createVerificationValue({
      identifier: key,
      value: `${stored}:${attempts + 1}`,
      expiresAt: row.expiresAt,
    })
  }
  refuse("BAD_REQUEST", "INVALID_OTP")
}

async function signedIn(ctx: Ctx, user: User) {
  // ASVS V7.2.4: end current token
  const current = await getSessionFromCtx(ctx, { disableRefresh: true })
  if (current) {
    await ctx.context.internalAdapter.deleteSession(current.session.token)
  }
  const session = await ctx.context.internalAdapter.createSession(user.id)
  if (!session) throw new APIError("INTERNAL_SERVER_ERROR")
  // Two-factor hook reads newSession
  await setSessionCookie(ctx, { session, user: user as never })
  return ctx.json({ status: true })
}

function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true
  }
  return false
}

/** Identifier-first sign-in, two channels. */
export function accountOtp(deps: AccountOtpDeps): BetterAuthPlugin {
  return {
    id: "account-otp",
    endpoints: {
      accountLookup: createAuthEndpoint(
        ACCOUNT_PATHS.lookup,
        {
          method: "POST",
          body: z.object({ identifier: z.string().max(320) }),
        },
        async (ctx) => {
          const holder = await holderOf(ctx, ctx.body.identifier)
          // Unproven: use the other
          if (!holder?.proven) {
            return ctx.json(
              holder
                ? { found: false as const, unproven: true as const }
                : { found: false as const },
            )
          }
          const user = holder.user
          const typed = identifierKind(ctx.body.identifier)?.kind
          return ctx.json({
            found: true as const,
            email: destination(emailOf(user), typed === "email", maskEmail),
            whatsapp: destination(
              user.phoneNumber ?? null,
              typed === "phone",
              maskPhone,
            ),
            whatsappReady: await deps.whatsapp.ready(),
          })
        },
      ),
      accountCheckNew: createAuthEndpoint(
        ACCOUNT_PATHS.checkNew,
        { method: "POST", body: signUp.omit({ mode: true, channel: true }) },
        async (ctx) => {
          const account = newAccount({
            ...ctx.body,
            mode: "sign-up",
            channel: "email",
          })
          const clash = await clashOf(ctx, account)
          return ctx.json({
            taken: clash.taken,
            only: clash.only,
            email: maskEmail(account.email),
            whatsapp: maskPhone(account.phone),
            whatsappReady: await deps.whatsapp.ready(),
          })
        },
      ),
      accountSendCode: createAuthEndpoint(
        ACCOUNT_PATHS.send,
        { method: "POST", body: sendBody },
        async (ctx) => {
          const target = await targetOf(ctx, ctx.body)
          const value = generateRandomString(6, "0-9")
          const adapter = ctx.context.internalAdapter
          // Stored once a send succeeds
          const store = async () => {
            await adapter.deleteVerificationByIdentifier(target.key)
            await adapter.createVerificationValue({
              identifier: target.key,
              value: `${hashCode(value)}:0`,
              expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
            })
          }
          const to = masked(ctx.body.channel, target.to)
          const client = ctx.headers?.get("x-client-ip") ?? null
          if (ctx.body.channel === "email") {
            const deliver = await deps.sendEmail(target.to, {
              unproven: target.unproven,
              client,
            })
            await store()
            deliver(value)
            return ctx.json({ channel: "email" as const, to, statusId: null })
          }
          const sent = await deps.whatsapp.sendCode(
            target.to,
            value,
            target.unproven
              ? { purpose: "sign-up", client }
              : { purpose: "sign-in", client },
          )
          if (sent.ok) {
            await store()
            return ctx.json({
              channel: "whatsapp" as const,
              to,
              statusId: sent.logId,
            })
          }
          if (sent.reason === "spacing" || sent.reason === "daily") {
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "OTP_LIMIT",
              message: "Too many codes",
            })
          }
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "WHATSAPP_UNAVAILABLE",
            message: "Use email",
          })
        },
      ),
      accountVerifyCode: createAuthEndpoint(
        ACCOUNT_PATHS.verify,
        { method: "POST", body: verifyBody },
        async (ctx) => {
          const body = ctx.body
          // Before the code is spent
          if (
            body.mode === "sign-up" &&
            !ageDeclarationSchema.safeParse(body.ageDeclaration).success
          ) {
            refuse("BAD_REQUEST", "AGE_DECLARATION_REQUIRED")
          }
          const target = await targetOf(ctx, body).catch((error: unknown) => {
            // Taken since the send
            if (error instanceof APIError && body.mode === "sign-up")
              throw error
            if (error instanceof APIError) refuse("BAD_REQUEST", "INVALID_OTP")
            throw error
          })
          await consumeCode(ctx, target.key, body.code)
          const email = body.channel === "email"
          if (target.user) {
            const verified = email
              ? target.user.emailVerified
              : target.user.phoneVerified === true
            const user = verified
              ? target.user
              : await ctx.context.internalAdapter.updateUser(
                  target.user.id,
                  email ? { emailVerified: true } : { phoneVerified: true },
                )
            return signedIn(ctx, user as User)
          }
          const account = target.account
          if (!account) throw new APIError("INTERNAL_SERVER_ERROR")
          // Proven here, unproven there
          if (target.release) {
            await ctx.context.internalAdapter.updateUser(target.release.id, {
              ...(email
                ? { email: releasedEmail(target.release.id) }
                : { phoneNumber: null }),
              // Kept: staff sessions stay valid
              updatedAt: target.release.updatedAt,
            })
          }
          const created = await ctx.context.internalAdapter
            .createUser(
              {
                name: account.name,
                email: account.email,
                emailVerified: email,
                phoneNumber: account.phone,
                phoneVerified: !email,
              },
              { method: "account-otp" },
            )
            .catch((error: unknown) => {
              if (isUniqueViolation(error)) refuse("CONFLICT", "ACCOUNT_EXISTS")
              throw error
            })
          return signedIn(ctx, created as User)
        },
      ),
      accountCodeStatus: createAuthEndpoint(
        ACCOUNT_PATHS.status,
        { method: "POST", body: z.object({ id: z.uuid() }) },
        async (ctx) =>
          ctx.json({ status: await deps.whatsapp.status(ctx.body.id) }),
      ),
    },
  }
}
