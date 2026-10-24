import { data, type RouterContextProvider, redirect } from "react-router"
import type { MemberRole } from "../../../db/schema/auth.ts"
import { pgError } from "../../../db/tenant.server.ts"
import {
  type Auth,
  getAuth,
  isSuperadmin,
  memberRole,
  STAFF_ROLES,
  staffAccess,
  staffTotpRequired,
  superadminAccess,
} from "../../../server/auth.server.ts"
import { errorRecord, writeError } from "../../../server/log.ts"
import {
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"

export type TwoFactorView =
  | { mode: "sign_in" }
  | { mode: "challenge" }
  | { mode: "not_staff" }
  | { mode: "done" }
  | { mode: "stale" }
  | { mode: "enroll"; email: string }

const isStaff = (role: MemberRole | null) =>
  role !== null && STAFF_ROLES.includes(role)

/** Where a verified session goes. */
export function staffHome(role: MemberRole | null): "/kelola" | "/admin" {
  return isStaff(role) ? "/kelola" : "/admin"
}

/** Which step this visitor needs. */
export function twoFactorView(input: {
  session: SessionContext | null
  role: MemberRole | null
  superadmin?: boolean
  hasChallenge: boolean
  now: Date
  // Dev switch, see staffTotpRequired
  totp?: boolean
}): TwoFactorView {
  const { session, role, now, totp = true } = input
  const superadmin = input.superadmin === true
  if (!session) return { mode: input.hasChallenge ? "challenge" : "sign_in" }
  if (!isStaff(role) && !superadmin) return { mode: "not_staff" }
  if (totp && !session.user.twoFactorEnabled) {
    return { mode: "enroll", email: session.user.email }
  }
  const access = {
    user: session.user,
    session: session.session,
    now,
    totp,
  }
  return staffAccess({ role, ...access }) ||
    superadminAccess({ superadmin, ...access })
    ? { mode: "done" }
    : { mode: "stale" }
}

// Loader then picks the home
const TWO_FACTOR = "/masuk/dua-langkah"

const CHALLENGE_COOKIE = /(?:^|;\s*)(?:__Secure-)?sm\.two_factor=/

export function hasChallengeCookie(cookie: string | null): boolean {
  return cookie ? CHALLENGE_COOKIE.test(cookie) : false
}

export function readTotpCode(value: unknown): string | null {
  const code = String(value ?? "").replace(/\s+/g, "")
  return /^\d{6}$/.test(code) ? code : null
}

// Better Auth: xxxxx-xxxxx, case-sensitive
export function readBackupCode(value: unknown): string | null {
  const code = String(value ?? "").replace(/\s+/g, "")
  const bare = /^[A-Za-z0-9]{10}$/.test(code)
    ? `${code.slice(0, 5)}-${code.slice(5)}`
    : code
  return /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(bare) ? bare : null
}

/** Base32 key for manual entry. */
export function secretFromUri(uri: string): string | null {
  if (!uri.startsWith("otpauth://totp/")) return null
  return new URL(uri).searchParams.get("secret")
}

type Args = { request: Request; context: Readonly<RouterContextProvider> }

type ViewFor = { view: TwoFactorView; home: "/kelola" | "/admin" }

async function viewFor({ request, context }: Args): Promise<ViewFor> {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  const role = session ? await memberRole(tenant.id, session.user.id) : null
  const view = twoFactorView({
    session,
    role,
    superadmin: session ? await isSuperadmin(session.user.id) : false,
    hasChallenge: hasChallengeCookie(request.headers.get("cookie")),
    now: new Date(),
    totp: staffTotpRequired(),
  })
  return { view, home: staffHome(role) }
}

export type TwoFactorPage = Extract<
  TwoFactorView,
  { mode: "challenge" | "stale" | "enroll" }
>

export async function twoFactorLoader(args: Args): Promise<TwoFactorPage> {
  const { view, home } = await viewFor(args)
  if (view.mode === "sign_in") throw redirect("/masuk")
  if (view.mode === "done") throw redirect(home)
  if (view.mode === "not_staff") throw data(null, { status: 403 })
  return view
}

type TwoFactorError =
  | "format"
  | "wrong"
  | "failed"
  | "unsaved"
  | "backup_format"
  | "backup_wrong"

export type TwoFactorActionData =
  | { kind: "enrolled"; uri: string; secret: string; backupCodes: string[] }
  | {
      kind: "error"
      error: TwoFactorError
      uri?: string
      // Enrollment only, until verified
      backupCodes?: string[]
      saved?: boolean
    }

/** Pending codes, enrollment only. */
async function pendingCodes(
  api: Auth["api"],
  headers: Headers,
  userId: string,
): Promise<string[]> {
  try {
    const result = await api.viewBackupCodes({ headers, body: { userId } })
    return result.backupCodes
  } catch (error) {
    writeError({ msg: "backup codes unavailable", ...errorRecord(error) })
    return []
  }
}

/** Forwards Better Auth cookies. */
function redirectWith(to: string, from: Response): Response {
  const headers = new Headers()
  for (const cookie of from.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie)
  }
  return redirect(to, { status: 303, headers })
}

export async function twoFactorAction(
  args: Args,
  auth?: Auth,
): Promise<TwoFactorActionData | Response> {
  const { view, home } = await viewFor(args)
  const api = (auth ?? (await getAuth())).api
  const headers = args.request.headers
  const form = await args.request.formData()
  const intent = form.get("intent")

  if (intent === "enroll" && view.mode === "enroll") {
    // Concurrent enroll hits UNIQUE
    const result = await api
      .enableTwoFactor({ headers, body: { method: "totp" } })
      .catch((error: unknown) => {
        if (pgError(error)?.code === "23505") return null
        throw error
      })
    if (!result) return { kind: "error", error: "failed" }
    const secret =
      result.method === "totp" ? secretFromUri(result.totpURI) : null
    if (result.method !== "totp" || !secret) {
      return { kind: "error", error: "failed" }
    }
    return {
      kind: "enrolled",
      uri: result.totpURI,
      secret,
      backupCodes: result.backupCodes,
    }
  }

  if (
    intent === "verify" &&
    (view.mode === "enroll" || view.mode === "challenge")
  ) {
    const uri = String(form.get("uri") ?? "")
    const shown = secretFromUri(uri) ? uri : undefined
    const enrolling = view.mode === "enroll"
    const saved = form.get("saved") === "yes"
    // Codes stay visible until verified
    const fail = async (
      error: TwoFactorError,
    ): Promise<TwoFactorActionData> => {
      const userId = args.context.get(sessionContext)?.user.id
      if (!enrolling || !shown || !userId) {
        return { kind: "error", error, uri: shown }
      }
      const backupCodes = await pendingCodes(api, headers, userId)
      return { kind: "error", error, uri: shown, backupCodes, saved }
    }
    if (enrolling && shown && !saved) return fail("unsaved")
    const code = readTotpCode(form.get("code"))
    if (!code) return fail("format")
    // Never trustDevice: TOTP every sign-in
    const response = await api.verifyTOTP({
      headers,
      body: { code },
      asResponse: true,
    })
    // Challenge has no role yet
    if (response.ok)
      return redirectWith(enrolling ? home : TWO_FACTOR, response)
    return fail("wrong")
  }

  // Lost phone: single-use code
  if (intent === "backup" && view.mode === "challenge") {
    const code = readBackupCode(form.get("code"))
    if (!code) return { kind: "error", error: "backup_format" }
    const response = await api.verifyBackupCode({
      headers,
      body: { code },
      asResponse: true,
    })
    if (response.ok) return redirectWith(TWO_FACTOR, response)
    return { kind: "error", error: "backup_wrong" }
  }

  if (intent === "sign_out" && view.mode === "stale") {
    const response = await api.signOut({ headers, asResponse: true })
    return redirectWith("/masuk", response)
  }
  throw data(null, { status: 400 })
}
