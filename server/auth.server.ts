import { type BetterAuthPlugin, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { generateRandomString, symmetricDecrypt } from "better-auth/crypto"
import { organization, twoFactor } from "better-auth/plugins"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import type { SessionContext } from "../app/context.ts"
import { type Db, database } from "../db/client.server.ts"
import { processGlobal } from "../db/process-global.ts"
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
import { parseAuthSecrets } from "./auth-secrets.ts"
import { createEmailSender, type EmailSender } from "./email.ts"
import {
  addressHash,
  hashKey,
  reserveOtp,
  sendLogged,
  valueHash,
} from "./email-log.ts"
import { renderOtpMail } from "./emails/render.ts"
import {
  errorRecord,
  type LogRecord,
  securityRecord,
  writeError,
  writeLog,
} from "./log.ts"
import { parseSealKey } from "./seal.ts"
import { currentStep, matchedStep } from "./totp-step.ts"
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
  // OWASP A09: refusals, tests capture
  securityLog?: (line: LogRecord) => void
}

const OTP_SEND_PATH = ACCOUNT_PATHS.send
const TOTP_VERIFY_PATH = "/two-factor/verify-totp"
const TOTP_ENABLE_PATH = "/two-factor/enable"
// Better Auth freshAge, seconds
const FRESH_AGE_S = 300

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
  ["/sign-out", {}],
  [ACCOUNT_PATHS.lookup, { identifier: null }],
  [ACCOUNT_PATHS.checkNew, { name: null, email: null, phone: null }],
  [OTP_SEND_PATH, SEND_FIELDS],
  [ACCOUNT_PATHS.verify, { ...SEND_FIELDS, code: null, ageDeclaration: null }],
  [ACCOUNT_PATHS.status, { id: null }],
  // TOTP enrollment, refused once enabled
  [TOTP_ENABLE_PATH, { method: "totp" }],
  // No trustDevice: TOTP every sign-in
  [TOTP_VERIFY_PATH, { code: null }],
  ["/two-factor/verify-backup-code", { code: null }],
  // Team changes: own code
])
// Unrouted endpoints our server calls
const SERVER_ONLY_CALLS: ReadonlySet<string> = new Set([
  // ASVS V3.3.4: body carries token
  "getSession",
  "viewBackupCodes",
  "rotateSession",
])
/** Set upstream, missing from types. */
function operationOf(ctx: object): string {
  return "operationId" in ctx && typeof ctx.operationId === "string"
    ? ctx.operationId
    : ""
}
// Editor waits for Phase 2
export const STAFF_ROLES: readonly MemberRole[] = ["editor", "admin"]
const STAFF_SESSION_MS = 12 * 60 * 60 * 1000
// Starting Values: absolute lifetime
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000
// Starting Values: TOTP accounts idle
const TOTP_IDLE_MS = 30 * 60 * 1000
// One write a minute
const SEEN_WRITE_MS = 60 * 1000
// Campus NAT shares addresses
const CGNAT_LIMIT = { window: 60, max: 20 }

// Awaited on shutdown
const inFlightEmails = processGlobal(
  "otp-emails",
  () => new Set<Promise<void>>(),
)

function track(send: Promise<void>): void {
  const tracked = send
    .catch((error: unknown) => {
      // Scrubbed, error stream
      writeError({ msg: "otp email failed", ...errorRecord(error) })
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

const BACKUP_VERIFY_PATH = "/two-factor/verify-backup-code"
// ASVS V16.3.1: factor per path
const FACTORS: ReadonlyMap<string, string> = new Map([
  [TOTP_VERIFY_PATH, "totp"],
  [BACKUP_VERIFY_PATH, "backup_code"],
  [TOTP_ENABLE_PATH, "totp_enrol"],
  ["/sign-out", "sign_out"],
])
// Successes worth a line
const LOGGED_SUCCESS = new Set([ACCOUNT_PATHS.verify, ...FACTORS.keys()])
// The staff page calls these
const IN_PROCESS_LOGGED = new Set([
  TOTP_VERIFY_PATH,
  BACKUP_VERIFY_PATH,
  TOTP_ENABLE_PATH,
])

type EventContext = {
  request?: Request
  headers?: Headers
  path: string
  body?: unknown
}

/** Host, or undefined: no line. */
function eventHost(ctx: EventContext): string | null | undefined {
  if (ctx.request) return new URL(ctx.request.url).host
  // In-process sign-out: caller logs
  if (!IN_PROCESS_LOGGED.has(ctx.path)) return undefined
  return ctx.headers?.get("host") ?? null
}

function bodyField(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined
}

/** Factor, keyed subject, no contact. */
function eventFields(ctx: EventContext, host: string | null, key: Buffer) {
  const channel = bodyField(ctx.body, "channel")
  const coded = ctx.path === ACCOUNT_PATHS.verify || ctx.path === OTP_SEND_PATH
  const subject =
    bodyField(ctx.body, "identifier") ??
    bodyField(ctx.body, channel === "whatsapp" ? "phone" : "email")
  return {
    host,
    path: ctx.path,
    factor: coded
      ? channel === "whatsapp"
        ? "whatsapp"
        : "email"
      : (FACTORS.get(ctx.path) ?? null),
    // Joins email_log.address_hash
    subject_hash:
      typeof subject === "string" && subject ? addressHash(subject, key) : null,
  }
}

/** Refused step, no contacts. */
function refusalRecord(ctx: EventContext, error: unknown, key: Buffer) {
  const host = eventHost(ctx)
  if (host === undefined || !(error instanceof APIError)) return null
  const code = (error.body as { code?: unknown } | undefined)?.code
  return securityRecord("auth_refused", {
    ...eventFields(ctx, host, key),
    status: error.statusCode,
    code: typeof code === "string" ? code : null,
  })
}

/** Completed step, no contacts. */
function successRecord(
  ctx: EventContext & {
    context: {
      returned?: unknown
      newSession?: { user: { id: string; twoFactorEnabled?: unknown } } | null
      session?: { user: { id: string } } | null
    }
  },
  key: Buffer,
  signedOut: string | undefined,
) {
  const host = eventHost(ctx)
  if (host === undefined || !LOGGED_SUCCESS.has(ctx.path)) return null
  const returned = ctx.context.returned
  if (returned instanceof Error) return null
  if (returned instanceof Response && !returned.ok) return null
  const fresh = ctx.context.newSession?.user
  return securityRecord("auth_ok", {
    ...eventFields(ctx, host, key),
    user_id: fresh?.id ?? ctx.context.session?.user.id ?? signedOut ?? null,
    // Code sign-in, TOTP follows
    second_factor: fresh?.twoFactorEnabled === true,
  })
}

/** ASVS V3.3.4: no body token. */
function withoutToken(returned: unknown): Record<string, unknown> | null {
  if (typeof returned !== "object" || returned === null) return null
  if (returned instanceof Response || returned instanceof Error) return null
  const { token, session, ...rest } = returned as Record<string, unknown>
  const nested =
    typeof session === "object" && session !== null && "token" in session
  if (token === undefined && !nested) return null
  if (session === undefined) return rest
  if (!nested) return { ...rest, session }
  const { token: _dropped, ...kept } = session as Record<string, unknown>
  return { ...rest, session: kept }
}

/** ASVS V7.2.4: step-up rotates token. */
function sessionRotation() {
  return {
    id: "session-rotation",
    endpoints: {
      rotateSession: createAuthEndpoint(
        "/session/rotate",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const { session, user } = ctx.context.session
          // Same start, 12 h holds
          const fresh = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            {
              createdAt: session.createdAt,
              expiresAt: session.expiresAt,
              // TOTP step-up is activity
              lastSeenAt: new Date(),
            },
            true,
          )
          if (!fresh) throw new APIError("INTERNAL_SERVER_ERROR")
          await ctx.context.internalAdapter.deleteSession(session.token)
          await setSessionCookie(ctx, { session: fresh, user })
          return ctx.json({ id: fresh.id })
        },
      ),
    },
  } satisfies BetterAuthPlugin
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

/** ASVS V7.5.1: recent code sign-in. */
async function requireFreshSignIn(ctx: HookContext): Promise<void> {
  const found = await getSessionFromCtx(ctx, { disableRefresh: true })
  // No session: endpoint answers 401
  if (!found) return
  const age = Date.now() - new Date(found.session.createdAt).getTime()
  if (age <= FRESH_AGE_S * 1000) return
  throw new APIError("FORBIDDEN", {
    code: "SESSION_NOT_FRESH",
    message: "Sign in again",
  })
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
  const now = Date.now()
  const step = matchedStep(secret, code, now)
  if (step === null) return
  // ASVS V6.5.5: current or previous
  if (step > currentStep(now)) {
    throw new APIError("UNAUTHORIZED", {
      code: "INVALID_CODE",
      message: "Invalid code",
    })
  }
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

// ASVS V6.5.2: 119-bit codes
const BACKUP_CODE_LENGTH = 20

/** Ten codes, xxxxx-xxxxx-xxxxx-xxxxx. */
function backupCodes(): string[] {
  return Array.from(
    { length: 10 },
    () =>
      generateRandomString(BACKUP_CODE_LENGTH, "a-z", "0-9", "A-Z")
        .match(/.{5}/g)
        ?.join("-") ?? "",
  )
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
  const securityLog = deps.securityLog ?? writeLog
  // Sign-out deletes the session first
  const signingOut = new WeakMap<object, string>()
  const twoFactorPlugin = twoFactor({
    allowPasswordless: true,
    issuer: "Sadar Bersuara",
    backupCodeOptions: { customBackupCodesGenerate: backupCodes },
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
      additionalFields: {
        lastSeenAt: { type: "date", required: false, input: false },
      },
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: FRESH_AGE_S,
    },
    advanced: {
      // ASVS V3.3.3: host-only names
      cookiePrefix: deps.dev ? "sb" : "__Host-sb",
      useSecureCookies: false,
      defaultCookieAttributes: { secure: !deps.dev },
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
        try {
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
          if (ctx.path === TOTP_ENABLE_PATH) await requireFreshSignIn(ctx)
          if (ctx.path === "/sign-out" && ctx.request) {
            const found = await getSessionFromCtx(ctx, { disableRefresh: true })
            if (found) signingOut.set(ctx.context, found.user.id)
          }
          // Last: claims the TOTP step
          if (ctx.path === TOTP_VERIFY_PATH) await claimTotpStep(ctx, deps.db)
        } catch (error) {
          const record = refusalRecord(ctx, error, deps.hashKey())
          if (record) securityLog(record)
          throw error
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const key = deps.hashKey()
        const record =
          refusalRecord(ctx, ctx.context.returned, key) ??
          successRecord(ctx, key, signingOut.get(ctx.context))
        if (record) securityLog(record)
        // Cookie only over HTTP
        if (!ctx.request) return
        const body = withoutToken(ctx.context.returned)
        if (body) return ctx.json(body)
      }),
    },
    plugins: [
      accountOtp({
        sendEmail: (to, options) => reserveEmailCode(deps, to, options),
        whatsapp: deps.whatsapp,
      }),
      twoFactorPlugin,
      accountOtpStepUp(twoFactorPlugin),
      sessionRotation(),
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

// Shared with the SSR bundle
const auth = processGlobal("auth", (): { promise?: Promise<Auth> } => ({}))

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
    // ASVS V11.2.3: refuse weak keys
    secrets: parseAuthSecrets(process.env.BETTER_AUTH_SECRETS),
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
  auth.promise = undefined
}

/** Lazy: dev never runs server/index.ts. */
export function getAuth(): Promise<Auth> {
  auth.promise ??= authFromEnv().catch((error: unknown) => {
    auth.promise = undefined
    throw error
  })
  return auth.promise
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
      if (error instanceof APIError && error.statusCode < 500) return null
      throw error
    })
  if (!found) return { session: null, setCookie: [] }
  const setCookie = found.headers.getSetCookie()
  const value = found.response
  if (!value) return { session: null, setCookie }
  const { user, session } = value
  const now = Date.now()
  const lastSeen = new Date(session.lastSeenAt ?? session.createdAt).getTime()
  if (
    // ASVS V7.3.2: absolute cap
    now - new Date(session.createdAt).getTime() > SESSION_MAX_MS ||
    // ASVS V7.3.1: staff and superadmin
    (user.twoFactorEnabled === true && now - lastSeen > TOTP_IDLE_MS)
  ) {
    const ended = await auth.api.signOut({ headers, returnHeaders: true })
    return { session: null, setCookie: ended.headers.getSetCookie() }
  }
  if (now - lastSeen >= SEEN_WRITE_MS) {
    const context = await auth.$context
    await context.internalAdapter.updateSession(session.token, {
      lastSeenAt: new Date(now),
    })
  }
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

/** Flag, sb_app cannot write. */
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
}

/** TOTP, fresh session, 12h cap. */
function verifiedSession({ user, session, now }: AccessInput): boolean {
  if (!user.twoFactorEnabled) return false
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
export function staffAccess(input: {
  role: MemberRole | null
  user: { twoFactorEnabled: boolean; updatedAt: Date }
  session: { createdAt: Date }
  now: Date
}): boolean {
  if (!input.role || !STAFF_ROLES.includes(input.role)) return false
  return verifiedSession(input)
}
