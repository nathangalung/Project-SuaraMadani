// Bun: full app in-process
import { createHmac } from "node:crypto"
import type { RouteConfigEntry } from "@react-router/dev/routes"
import { eq } from "drizzle-orm"
import type { Pool } from "pg"
import {
  createRequestHandler,
  type ServerBuild,
  UNSAFE_decodeViaTurboStream,
  UNSAFE_withComponentProps,
  UNSAFE_withErrorBoundaryProps,
  UNSAFE_withHydrateFallbackProps,
} from "react-router"
import type { SessionContext, TenantContext } from "../app/context.ts"
import * as entry from "../app/entry.server.tsx"
import * as root from "../app/root.tsx"
import routeConfig from "../app/routes.ts"
import { database } from "../db/client.server.ts"
import { members, twoFactors, users } from "../db/schema/auth.ts"
import { forgetTenant, getTenantByHost } from "../db/tenant.server.ts"
import { createApp } from "../server/app.ts"
import {
  createAuth,
  drainEmails,
  readSession,
  resetAuth,
} from "../server/auth.server.ts"
import { parseAuthSecrets } from "../server/auth-secrets.ts"
import type { EmailMessage } from "../server/email.ts"
import { hashKey } from "../server/email-log.ts"
import { poolHealth } from "../server/health.ts"
import type { LogRecord } from "../server/log.ts"
import { originFor } from "../server/origin.server.ts"
import { linkKeyring } from "../server/signed-link.ts"
import { AGE_CONSENT_VERSION } from "../shared/report-fields.ts"
import { createEmailSendHandler } from "../worker/email-send.ts"
import {
  createDemandNotifyHandler,
  createIssueNotifyHandler,
} from "../worker/issue-notify.ts"

type ServerModule = NonNullable<ServerBuild["routes"][string]>["module"]
type Component = Parameters<typeof UNSAFE_withComponentProps>[0]
type Boundary = Parameters<typeof UNSAFE_withErrorBoundaryProps>[0]
type Fallback = Parameters<typeof UNSAFE_withHydrateFallbackProps>[0]

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
// Turnstile token that passes
export const CAPTCHA_PASS = "pass"

/** Mirrors the Vite plugin wrap. */
function wrap(module: Record<string, unknown>): ServerModule {
  const wrapped: Record<string, unknown> = { ...module }
  if (module.default) {
    wrapped.default = UNSAFE_withComponentProps(module.default as Component)
  }
  if (module.ErrorBoundary) {
    wrapped.ErrorBoundary = UNSAFE_withErrorBoundaryProps(
      module.ErrorBoundary as Boundary,
    )
  }
  if (module.HydrateFallback) {
    wrapped.HydrateFallback = UNSAFE_withHydrateFallbackProps(
      module.HydrateFallback as Fallback,
    )
  }
  return wrapped as unknown as ServerModule
}

type Flat = { id: string; parentId: string; entry: RouteConfigEntry }

function flatten(entries: RouteConfigEntry[], parentId: string): Flat[] {
  return entries.flatMap((one) => {
    const id = one.id ?? one.file.replace(/\.tsx?$/, "")
    return [{ id, parentId, entry: one }, ...flatten(one.children ?? [], id)]
  })
}

/** Every route in app/routes.ts. */
async function serverBuild(): Promise<ServerBuild> {
  const routes: ServerBuild["routes"] = {}
  const assets: ServerBuild["assets"]["routes"] = {}
  const add = (
    id: string,
    parentId: string | undefined,
    path: string | undefined,
    index: boolean | undefined,
    module: ServerModule,
  ) => {
    routes[id] = { id, parentId, path, index, module }
    assets[id] = {
      id,
      parentId,
      path,
      index,
      module: `/${id}.js`,
      hasAction: "action" in module,
      hasLoader: "loader" in module,
      // Fallback renders on the server
      hasClientAction: "clientAction" in module,
      hasClientLoader: "clientLoader" in module,
      hasClientMiddleware: false,
      hasErrorBoundary: "ErrorBoundary" in module,
      clientActionModule: undefined,
      clientLoaderModule: undefined,
      clientMiddlewareModule: undefined,
      hydrateFallbackModule: undefined,
    }
  }
  add("root", undefined, "", undefined, wrap(root))
  for (const { id, parentId, entry: one } of flatten(routeConfig, "root")) {
    const module = (await import(`../app/${one.file}`)) as Record<
      string,
      unknown
    >
    add(id, parentId, one.path, one.index, wrap(module))
  }
  return {
    entry: { module: entry },
    routes,
    assets: {
      entry: { imports: [], module: "/entry.client.js" },
      routes: assets,
      url: "/manifest.js",
      version: "test",
    },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  }
}

export type FullApp = {
  request: (url: string, init?: RequestInit) => Promise<Response>
  lines: LogRecord[]
}

/** Hono, React Router, middleware. */
export async function fullApp(
  options: {
    apiRateLimit?: { max: number; windowMs: number }
    healthToken?: string
  } = {},
): Promise<FullApp> {
  const handler = createRequestHandler(await serverBuild(), "production")
  const lines: LogRecord[] = []
  const { pool, db } = database()
  const app = createApp({
    handleDocument: (request) => handler(request),
    // Same checks as server/index.ts
    health: poolHealth(pool, db),
    sha: "acceptance",
    log: (line) => lines.push(line),
    errorLog: (line) => lines.push(line),
    hsts: "max-age=300",
    ...(options.apiRateLimit ? { apiRateLimit: options.apiRateLimit } : {}),
    ...(options.healthToken ? { healthToken: options.healthToken } : {}),
  })
  return {
    // Real clients always send Host
    request: async (url, init = {}) => {
      const headers = new Headers(init.headers)
      if (!headers.has("host")) headers.set("host", new URL(url).host)
      return await app.request(url, { ...init, headers })
    },
    lines,
  }
}

/** Single-fetch body, client view. */
export async function decoded(res: Response): Promise<unknown> {
  if (!res.body) return null
  const { done, value } = await UNSAFE_decodeViaTurboStream(
    res.body,
    globalThis,
  )
  await done
  return value
}

/** Action data, .data POST. */
export async function actionData<T>(res: Response): Promise<T> {
  const value = (await decoded(res)) as { data?: T } | null
  if (!value || !("data" in value)) {
    throw new Error(`no action data: ${JSON.stringify(value)}`)
  }
  return value.data as T
}

/** The one loader holding key. */
export async function loaderWith<T extends Record<string, unknown>>(
  res: Response,
  key: keyof T & string,
): Promise<T> {
  const routes = (await decoded(res)) as Record<string, { data?: unknown }>
  const found = Object.values(routes)
    .map((route) => route.data)
    .filter(
      (data): data is T =>
        typeof data === "object" && data !== null && key in data,
    )
  if (found.length !== 1) {
    throw new Error(`${found.length} loaders hold ${key}`)
  }
  return found[0] as T
}

/** New campus hosts, fresh caches. */
export function hostsChanged(hosts: string[]): void {
  for (const host of hosts) forgetTenant(host)
  resetAuth()
}

/** Cloudflare boundary, nothing else. */
export function stubTurnstile(): () => void {
  const real = globalThis.fetch
  const fake = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== SITEVERIFY) return real(input, init)
    const body = new URLSearchParams(String(init?.body ?? ""))
    const success = body.get("response") === CAPTCHA_PASS
    return Response.json({
      success,
      "error-codes": success ? [] : ["invalid-input-response"],
    })
  }
  globalThis.fetch = Object.assign(fake, { preconnect: real.preconnect })
  return () => {
    globalThis.fetch = real
  }
}

export type Account = { email: string; phone: string; name: string }

/** Cookie pairs from Set-Cookie. */
export function jar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0] ?? "")
    .filter((c) => !c.endsWith("="))
    .join("; ")
}

/** Same secrets and cookie name. */
function minter(host: string) {
  const origin = `http://${host}`
  const sent: { to: string; text: string }[] = []
  const auth = createAuth({
    db: database().db,
    hosts: [host],
    dev: true,
    email: { send: async (message) => void sent.push(message) },
    hashKey,
    verifyCaptcha: async () => ({ ok: true }),
    whatsapp: {
      ready: async () => false,
      sendCode: async () => ({ ok: false, reason: "unavailable" }),
      status: async () => null,
    },
    secrets: parseAuthSecrets(process.env.BETTER_AUTH_SECRETS),
  })
  async function post(path: string, body: unknown, cookie = "") {
    const res = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie },
        body: JSON.stringify(body),
      }),
    )
    if (res.status !== 200) {
      throw new Error(`${path} ${res.status} ${await res.text()}`)
    }
    return res
  }
  async function signIn(account: Account): Promise<Response> {
    const { db } = database()
    const [known] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, account.email))
    const body = known
      ? { mode: "sign-in", identifier: account.email, channel: "email" }
      : {
          mode: "sign-up",
          name: account.name,
          email: account.email,
          phone: account.phone,
          channel: "email",
        }
    const before = sent.length
    await post("/account/send-code", body)
    await drainEmails()
    for (let i = 0; i < 100 && sent.length === before; i++) await Bun.sleep(10)
    const code = /\b(\d{6})\b/.exec(
      sent.findLast((m) => m.to === account.email)?.text ?? "",
    )?.[1]
    if (!code) throw new Error("no sign-in code captured")
    return post("/account/verify-code", {
      ...body,
      code,
      ...(known
        ? {}
        : {
            ageDeclaration: {
              age_18_plus: true,
              ageConsentVersion: AGE_CONSENT_VERSION,
            },
          }),
    })
  }
  return { post, signIn }
}

/** Reporter or citizen session. */
export async function signedIn(
  host: string,
  account: Account,
): Promise<{ cookie: string; userId: string }> {
  const cookie = jar(await minter(host).signIn(account))
  const [user] = await database()
    .db.select({ id: users.id })
    .from(users)
    .where(eq(users.email, account.email))
  if (!user) throw new Error("account not created")
  return { cookie, userId: user.id }
}

/** RFC 6238 TOTP code. */
export function totp(secret: string, at: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const char of secret.toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0")
  }
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)),
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const mac = createHmac("sha1", key).update(counter).digest()
  const offset = (mac.at(-1) ?? 0) & 0xf
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  )
}

export type Staff = {
  cookie: string
  userId: string
  secret: string
  backupCodes: string[]
}

/** Admin with a TOTP-verified session. */
export async function staffSession(
  host: string,
  orgId: string,
  account: Account,
): Promise<Staff> {
  const { post, signIn } = minter(host)
  const { db } = database()
  const first = jar(await signIn(account))
  const enable = await post("/two-factor/enable", {}, first)
  const { totpURI, backupCodes } = (await enable.json()) as {
    totpURI: string
    backupCodes: string[]
  }
  const secret = new URL(totpURI).searchParams.get("secret") ?? ""
  await post(
    "/two-factor/verify-totp",
    { code: totp(secret, Date.now()) },
    first,
  )
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, account.email))
  if (!user) throw new Error("staff not created")
  await db
    .insert(members)
    .values({ organizationId: orgId, userId: user.id, role: "admin" })
  const again = jar(await signIn(account))
  await db
    .update(twoFactors)
    .set({ lastTotpStep: null })
    .where(eq(twoFactors.userId, user.id))
  const verified = await post(
    "/two-factor/verify-totp",
    { code: totp(secret, Date.now()) },
    again,
  )
  return { cookie: jar(verified), userId: user.id, secret, backupCodes }
}

export type QueuedJob<T> = { id: string; data: T; startAfter: Date }

/** Waiting jobs of one campus. */
export async function queued<T extends { orgId: string }>(
  su: Pool,
  queue: string,
  orgId: string,
): Promise<QueuedJob<T>[]> {
  const { rows } = await su.query<{
    id: string
    data: T
    start_after: Date
  }>(
    `SELECT id, data, start_after FROM pgboss.job
     WHERE name = $1 AND state = 'created' AND data->>'orgId' = $2
     ORDER BY created_on, id`,
    [queue, orgId],
  )
  return rows.map((row) => ({
    id: row.id,
    data: row.data,
    startAfter: row.start_after,
  }))
}

/** Worker step in process. */
export async function runQueued<T extends { orgId: string }, R>(
  su: Pool,
  queue: string,
  orgId: string,
  handler: (data: T) => Promise<R>,
): Promise<R[]> {
  const outcomes: R[] = []
  for (const job of await queued<T>(su, queue, orgId)) {
    // Claimed like pg-boss fetch
    await su.query(
      "UPDATE pgboss.job SET state = 'completed' WHERE name = $1 AND id = $2",
      [queue, job.id],
    )
    outcomes.push(await handler(job.data))
  }
  return outcomes
}

/** email-send with a capturing sender. */
export function mailbox(now: () => Date = () => new Date()) {
  const sent: EmailMessage[] = []
  const handler = createEmailSendHandler({
    email: { send: async (message) => void sent.push(message) },
    keyring: linkKeyring,
    hashKey,
    now,
    originFor,
  })
  const issues = createIssueNotifyHandler()
  const demands = createDemandNotifyHandler()
  return {
    sent,
    // Fan-out first, then mail
    deliver: async (su: Pool, orgId: string) => {
      await runQueued(su, "issue-notify", orgId, issues)
      await runQueued(su, "demand-notify", orgId, demands)
      return runQueued(su, "email-send", orgId, handler)
    },
  }
}

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:58025"

type MailpitList = { messages: { ID: string }[] }

/** Newest mail, then removed. */
export async function mailpitText(address: string): Promise<string> {
  const query = encodeURIComponent(`to:"${address}"`)
  // Sends are not awaited, poll
  for (let i = 0; i < 100; i++) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${query}`)
    ).json()) as MailpitList
    const id = list.messages[0]?.ID
    if (id) {
      const message = (await (
        await fetch(`${MAILPIT}/api/v1/message/${id}`)
      ).json()) as { Text: string }
      await fetch(`${MAILPIT}/api/v1/messages`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ IDs: list.messages.map((one) => one.ID) }),
      })
      return message.Text
    }
    await Bun.sleep(50)
  }
  throw new Error(`nothing mailed to ${address}`)
}

/** Newest mailed code. */
export async function mailpitCode(address: string): Promise<string> {
  const code = /\b(\d{6})\b/.exec(await mailpitText(address))?.[1]
  if (!code) throw new Error(`no code mailed to ${address}`)
  return code
}

/** Route inputs for contracts. */
export async function routeContext(
  host: string,
  cookie: string,
): Promise<{ tenant: TenantContext; session: SessionContext | null }> {
  const tenant = await getTenantByHost(host)
  if (!tenant) throw new Error(`no campus at ${host}`)
  const read = cookie
    ? await readSession(new Headers({ cookie, host }))
    : { session: null }
  return { tenant: tenant as TenantContext, session: read.session }
}

/** Form POST for contracts. */
export function formRequest(
  url: string,
  fields: Record<string, string>,
  clientIp = "10.0.0.1",
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: new URL(url).origin,
      "content-type": "application/x-www-form-urlencoded",
      "x-client-ip": clientIp,
    },
    body: new URLSearchParams(fields),
  })
}

/** Accounts of given age. */
export async function insertedUsers(
  su: Pool,
  count: number,
  ageDays: number,
): Promise<string[]> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO users (name, email, email_verified, age_declared_at, age_consent_version, created_at)
     SELECT 'Warga', 'warga-' || gen_random_uuid() || '@contoh.id', true, now(), $3,
       now() - make_interval(days => $2)
     FROM generate_series(1, $1) RETURNING id`,
    [count, ageDays, AGE_CONSENT_VERSION],
  )
  return rows.map((row) => row.id)
}

/** Drops jobs these campuses queued. */
export async function dropJobs(su: Pool, hosts: string[]): Promise<void> {
  await su.query(
    `DELETE FROM pgboss.job WHERE data->>'orgId' IN (
       SELECT id::text FROM organizations WHERE host = ANY($1))`,
    [hosts],
  )
}
