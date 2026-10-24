import { type BetterAuthPlugin, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api"
import { symmetricDecrypt } from "better-auth/crypto"
import { organization, twoFactor } from "better-auth/plugins"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import type { SessionContext } from "../app/context.ts"
import { type Db, database } from "../db/client.server.ts"
import {
  authSchema,
  MEMBER_ROLES,
  type MemberRole,
  members,
  organizationAdditionalFields,
  twoFactors,
  userAdditionalFields,
  users,
} from "../db/schema/auth.ts"
import { organizations } from "../db/schema/organizations.ts"
import { ageDeclarationSchema } from "../shared/report-schema.ts"
import { ACCOUNT_PATHS, accountOtp } from "./account-otp.server.ts"
import { clientKey } from "./api/upload.server.ts"
import { createEmailSender, type EmailSender } from "./email.ts"
import {
  addressHash,
  hashKey,
  reserveOtp,
  sendLogged,
  valueHash,
} from "./email-log.ts"
import { renderOtpMail } from "./emails/render.ts"
import { errorRecord, writeError, writeLog } from "./log.ts"
import { parseSealKey } from "./seal.ts"
import { matchedStep } from "./totp-step.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "./turnstile.server.ts"
import {
  createWhatsAppGateway,
  type WhatsAppGateway,
} from "./whatsapp.server.ts"

export type AuthDeps = {
  db: Db
  hosts: string[]
  dev: boolean
  email: EmailSender
  // email_log address HMAC key
  hashKey: () => Buffer
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
  ) => Promise<TurnstileResult>
  whatsapp: WhatsAppGateway
  secrets?: { version: number; value: string }[]
}

const OTP_SEND_PATH = ACCOUNT_PATHS.send
const TOTP_VERIFY_PATH = "/two-factor/verify-totp"

// null: any value, else pinned
type BodyRule = Readonly<Record<string, string | null>>

const SEND_FIELDS = {
  mode: null,
  identifier: null,
  name: null,
  email: null,
  phone: null,
  channel: null,
} as const

// Plugins expose more, default closed
const OPEN_AUTH_PATHS: ReadonlyMap<string, BodyRule> = new Map<
  string,
  BodyRule
>([
  ["/get-session", {}],
  ["/sign-out", {}],
  [ACCOUNT_PATHS.lookup, { identifier: null }],
  [ACCOUNT_PATHS.checkNew, { name: null, email: null, phone: null }],
  [OTP_SEND_PATH, SEND_FIELDS],
  [ACCOUNT_PATHS.verify, { ...SEND_FIELDS, code: null, ageDeclaration: null }],
  [ACCOUNT_PATHS.status, { id: null }],
  // TOTP enrollment, refused once enabled
  ["/two-factor/enable", { method: "totp" }],
  // No trustDevice: TOTP every sign-in
  [TOTP_VERIFY_PATH, { code: null }],
  ["/two-factor/verify-backup-code", { code: null }],
  // Team changes: own code
])
// Unrouted endpoints our server calls
const SERVER_ONLY_CALLS: ReadonlySet<string> = new Set(["viewBackupCodes"])
/** Set upstream, missing from types. */
function operationOf(ctx: object): string {
  return "operationId" in ctx && typeof ctx.operationId === "string"
    ? ctx.operationId
    : ""
}
// Editor waits for Phase 2
export const STAFF_ROLES: readonly MemberRole[] = ["editor", "admin"]
const STAFF_SESSION_MS = 12 * 60 * 60 * 1000
// Campus NAT shares addresses
const CGNAT_LIMIT = { window: 60, max: 20 }

// Awaited on shutdown
const inFlightEmails = new Set<Promise<void>>()

function track(send: Promise<void>): void {
  const tracked = send
    .catch((error: unknown) => {
      // Never log the address
      writeLog({
        msg: "otp email failed",
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => inFlightEmails.delete(tracked))
  inFlightEmails.add(tracked)
}

function sendOtp(
  deps: AuthDeps,
  to: string,
  code: string,
  logId?: string,
): Promise<void> {
  return sendLogged(deps.db, {
    kind: "otp",
    message: { to, ...renderOtpMail(code) },
    email: deps.email,
    key: deps.hashKey,
    logId,
  })
}

/** Caps first, send not awaited. */
async function reserveEmailCode(
  deps: AuthDeps,
  to: string,
  options: { unproven: boolean; client: string | null },
): Promise<(code: string) => void> {
  let logId: string | undefined
  // Like the limiter: production only
  if (!deps.dev) {
    const client = clientKey(options.client)
    const found = await reserveOtp(
      deps.db,
      addressHash(to, deps.hashKey()),
      new Date(),
      {
        unproven: options.unproven,
        client:
          client === "unknown" ? null : addressHash(client, deps.hashKey()),
      },
    )
    if (!found.ok) {
      throw found.reason === "quota" || found.reason === "busy"
        ? new APIError("SERVICE_UNAVAILABLE", {
            code: "EMAIL_QUOTA",
            message: "Try later",
          })
        : new APIError("TOO_MANY_REQUESTS", {
            code: "OTP_LIMIT",
            message: "Too many codes",
          })
    }
    logId = found.logId
  }
  // Not awaited: timing attacks
  return (code) => track(sendOtp(deps, to, code, logId))
}

export async function drainEmails(): Promise<void> {
  await Promise.allSettled([...inFlightEmails])
}

/** Adapter errors carry emails. */
export function authLog(level: string, message: string, ...args: unknown[]) {
  writeError({
    msg: "auth",
    level,
    message,
    ...(args.length > 0 ? errorRecord(args[0]) : {}),
  })
}

/** New accounts need a number. */
function requirePhone(user: Record<string, unknown>): void {
  if (typeof user.phoneNumber !== "string" || user.phoneNumber === "") {
    throw new APIError("BAD_REQUEST", {
      code: "PHONE_REQUIRED",
      message: "A phone number is required",
    })
  }
}

/** Question 7: box required */
function declareAge(body: unknown): {
  ageDeclaredAt: Date
  ageConsentVersion: string
} {
  const parsed = ageDeclarationSchema.safeParse(body)
  if (!parsed.success) {
    throw new APIError("BAD_REQUEST", {
      code: "AGE_DECLARATION_REQUIRED",
      message: "Confirm the 18+ statement to create an account",
    })
  }
  return {
    ageDeclaredAt: new Date(),
    ageConsentVersion: parsed.data.ageConsentVersion,
  }
}

/** Optional fields change behaviour. */
function refuseBodyFields(body: unknown, rule: BodyRule): void {
  if (body === undefined || body === null) return
  const refused =
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.entries(body).some(
      ([key, value]) =>
        !Object.hasOwn(rule, key) ||
        (rule[key] !== null && value !== rule[key]),
    )
  if (refused) {
    throw new APIError("BAD_REQUEST", {
      code: "FIELD_NOT_ALLOWED",
      message: "Field not accepted",
    })
  }
}

// Upstream hook skips our path
function accountOtpStepUp(plugin: BetterAuthPlugin): BetterAuthPlugin {
  const challenge = plugin.hooks?.after?.[0]
  if (!challenge) throw new Error("two-factor sign-in hook not found")
  return {
    id: "account-otp-step-up",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === ACCOUNT_PATHS.verify,
          handler: challenge.handler,
        },
      ],
    },
  }
}

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/** Session user, else challenge user. */
async function twoFactorUserId(ctx: HookContext): Promise<string | null> {
  const session = await getSessionFromCtx(ctx, { disableRefresh: true })
  if (session) return session.user.id
  const cookie = ctx.context.createAuthCookie("two_factor")
  const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
  if (!signed) return null
  const found = await ctx.context.internalAdapter.findVerificationValue(signed)
  return found?.value ?? null
}

// ASVS V6.5.1: upstream allows replay
async function claimTotpStep(ctx: HookContext, db: Db): Promise<void> {
  const code = (ctx.body as { code?: unknown } | undefined)?.code
  if (typeof code !== "string") return
  const userId = await twoFactorUserId(ctx)
  if (!userId) return
  const [row] = await db
    .select({ secret: twoFactors.secret })
    .from(twoFactors)
    .where(eq(twoFactors.userId, userId))
    .limit(1)
  if (!row) return
  const secret = await symmetricDecrypt({
    key: ctx.context.secretConfig,
    data: row.secret,
  })
  // No match: endpoint counts failure
  const step = matchedStep(secret, code, Date.now())
  if (step === null) return
  const claimed = await db
    .update(twoFactors)
    .set({ lastTotpStep: step })
    .where(
      and(
        eq(twoFactors.userId, userId),
        or(isNull(twoFactors.lastTotpStep), lt(twoFactors.lastTotpStep, step)),
      ),
    )
    .returning({ id: twoFactors.id })
  if (claimed.length === 0) {
    throw new APIError("UNAUTHORIZED", {
      code: "INVALID_CODE",
      message: "Invalid code",
    })
  }
}

// Hook fills NOT NULL columns
const userFields = {
  ageDeclaredAt: { ...userAdditionalFields.ageDeclaredAt, required: false },
  ageConsentVersion: {
    ...userAdditionalFields.ageConsentVersion,
    required: false,
  },
  phoneNumber: userAdditionalFields.phoneNumber,
  phoneVerified: userAdditionalFields.phoneVerified,
} as const

export function createAuth(deps: AuthDeps) {
  const twoFactorPlugin = twoFactor({
    allowPasswordless: true,
    issuer: "Sadar Bersuara",
  })
  return betterAuth({
    appName: "Sadar Bersuara",
    basePath: "/api/auth",
    baseURL: {
      // Explicit hosts, never a wildcard
      allowedHosts: deps.dev
        ? deps.hosts.flatMap((host) => [host, `${host}:*`])
        : deps.hosts,
      protocol: deps.dev ? "http" : "https",
    },
    secrets: deps.secrets,
    logger: { log: authLog },
    rateLimit: {
      // Tests run prod config
      enabled: !deps.dev,
      customRules: {
        [ACCOUNT_PATHS.lookup]: CGNAT_LIMIT,
        [ACCOUNT_PATHS.checkNew]: CGNAT_LIMIT,
        [OTP_SEND_PATH]: CGNAT_LIMIT,
        [ACCOUNT_PATHS.verify]: CGNAT_LIMIT,
      },
    },
    database: drizzleAdapter(deps.db, {
      provider: "pg",
      schema: authSchema,
      usePlural: true,
    }),
    user: { additionalFields: userFields },
    // Daftar keys hold contacts
    verification: {
      storeIdentifier: {
        default: "plain",
        overrides: {
          "account-otp:": {
            hash: async (identifier) => valueHash(identifier, deps.hashKey()),
          },
        },
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: 300,
    },
    advanced: {
      cookiePrefix: "sm",
      useSecureCookies: !deps.dev,
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-client-ip"] },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            requirePhone(user)
            return {
              data: {
                ...user,
                ...declareAge(
                  (ctx?.body as { ageDeclaration?: unknown } | undefined)
                    ?.ageDeclaration,
                ),
              },
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Server-only and in-process, never routed
        if (!ctx.request && SERVER_ONLY_CALLS.has(operationOf(ctx))) return
        const rule = OPEN_AUTH_PATHS.get(ctx.path)
        if (!rule) {
          throw new APIError("NOT_FOUND", {
            code: "ENDPOINT_DISABLED",
            message: "Not found",
          })
        }
        // Explicit guard, beside allowlist
        if (
          typeof ctx.body === "object" &&
          ctx.body !== null &&
          Object.hasOwn(ctx.body, "trustDevice")
        ) {
          throw new APIError("BAD_REQUEST", {
            code: "TRUST_DEVICE_DISABLED",
            message: "Trusted devices are disabled",
          })
        }
        // First: refused requests burn nothing
        refuseBodyFields(ctx.body, rule)
        if (ctx.path === OTP_SEND_PATH) {
          const result = await deps.verifyCaptcha(
            ctx.headers?.get("x-captcha-response") ?? null,
            ctx.headers?.get("x-client-ip") ?? null,
          )
          if (!result.ok) {
            throw new APIError("FORBIDDEN", {
              code: "CAPTCHA_FAILED",
              message: "Security check failed",
            })
          }
        }
        // Last: claims the TOTP step
        if (ctx.path === TOTP_VERIFY_PATH) await claimTotpStep(ctx, deps.db)
      }),
    },
    plugins: [
      accountOtp({
        sendEmail: (to, options) => reserveEmailCode(deps, to, options),
        whatsapp: deps.whatsapp,
      }),
      twoFactorPlugin,
      accountOtpStepUp(twoFactorPlugin),
      // TODO(P5): passkey, rpID at apex
      organization({
        allowUserToCreateOrganization: false,
        schema: {
          organization: { additionalFields: organizationAdditionalFields },
        },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let authPromise: Promise<Auth> | undefined

async function authFromEnv(): Promise<Auth> {
  const { db } = database()
  // Onboarding ends with a restart
  const rows = await db.select({ host: organizations.host }).from(organizations)
  return createAuth({
    db,
    hosts: rows.map((row) => row.host),
    dev: process.env.NODE_ENV !== "production",
    email: createEmailSender(),
    hashKey,
    verifyCaptcha: (token, remoteIp) =>
      verifyTurnstile(token, { secret: turnstileSecret(), remoteIp }),
    whatsapp: whatsappFromEnv(db),
  })
}

// No key: WhatsApp shown unavailable
const NO_WHATSAPP: WhatsAppGateway = {
  ready: async () => false,
  sendCode: async () => ({ ok: false, reason: "unavailable" }),
  status: async () => null,
}

function whatsappFromEnv(db: Db): WhatsAppGateway {
  const raw = process.env.WHATSAPP_JOB_KEY
  if (!raw?.trim()) return NO_WHATSAPP
  const key = parseSealKey(raw, "WHATSAPP_JOB_KEY")
  return createWhatsAppGateway({
    db,
    hashKey,
    jobKey: () => key,
    caps: process.env.NODE_ENV === "production",
  })
}

/** New campus host, rebuilt lazily. */
export function resetAuth(): void {
  authPromise = undefined
}

/** Lazy: dev never runs server/index.ts. */
export function getAuth(): Promise<Auth> {
  authPromise ??= authFromEnv().catch((error: unknown) => {
    authPromise = undefined
    throw error
  })
  return authPromise
}

export type SessionRead = {
  session: SessionContext | null
  setCookie: string[]
}

/** Keeps Better Auth's refreshed cookie. */
export async function readSessionWith(
  auth: Auth,
  headers: Headers,
): Promise<SessionRead> {
  const found = await auth.api
    .getSession({ headers, returnHeaders: true })
    .catch((error: unknown) => {
      // Concurrent sign-out: signed out
      if (error instanceof APIError) return null
      throw error
    })
  if (!found) return { session: null, setCookie: [] }
  const setCookie = found.headers.getSetCookie()
  const value = found.response
  if (!value) return { session: null, setCookie }
  const { user, session } = value
  return {
    session: {
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified === true,
        name: user.name,
        phoneNumber:
          typeof user.phoneNumber === "string" ? user.phoneNumber : null,
        phoneVerified: user.phoneVerified === true,
        twoFactorEnabled: user.twoFactorEnabled === true,
        updatedAt: new Date(user.updatedAt),
      },
      session: {
        id: session.id,
        createdAt: new Date(session.createdAt),
        expiresAt: new Date(session.expiresAt),
      },
    },
    setCookie,
  }
}

export async function readSession(headers: Headers): Promise<SessionRead> {
  return readSessionWith(await getAuth(), headers)
}

/** Role from Host tenant only. */
export async function memberRole(
  orgId: string,
  userId: string,
  db: Db = database().db,
): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.organizationId, orgId), eq(members.userId, userId)))
    .limit(1)
  const role = row?.role
  return role && MEMBER_ROLES.includes(role) ? role : null
}

/** Flag, sm_app cannot write. */
export async function isSuperadmin(
  userId: string,
  db: Db = database().db,
): Promise<boolean> {
  const [row] = await db
    .select({ superadmin: users.superadmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.superadmin === true
}

type AccessInput = {
  user: { twoFactorEnabled: boolean; updatedAt: Date }
  session: { createdAt: Date }
  now: Date
  // False only via staffTotpRequired
  totp?: boolean
}

/** Only dev may skip TOTP. */
export function staffTotpRequired(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !(env.NODE_ENV === "development" && env.STAFF_TOTP === "off")
}

/** TOTP, fresh session, 12h cap. */
function verifiedSession({
  user,
  session,
  now,
  totp = true,
}: AccessInput): boolean {
  if (totp && !user.twoFactorEnabled) return false
  if (session.createdAt.getTime() < user.updatedAt.getTime()) return false
  return now.getTime() - session.createdAt.getTime() <= STAFF_SESSION_MS
}

/** Same session rules as staff. */
export function superadminAccess(
  input: AccessInput & { superadmin: boolean },
): boolean {
  return input.superadmin && verifiedSession(input)
}

/** Session must postdate TOTP change. */
export function staffAccess(
  input: AccessInput & { role: MemberRole | null },
): boolean {
  if (!input.role || !STAFF_ROLES.includes(input.role)) return false
  return verifiedSession(input)
}
