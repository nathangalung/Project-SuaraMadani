import { eq, sql } from "drizzle-orm"
import { data, type RouterContextProvider, redirect } from "react-router"
import { type Db, database } from "../../../db/client.server.ts"
import { sessions } from "../../../db/schema/auth.ts"
import {
  type Auth,
  getAuth,
  staffTotpRequired,
} from "../../../server/auth.server.ts"
import {
  type LogRecord,
  securityRecord,
  writeLog,
} from "../../../server/log.ts"
import { sessionContext } from "../../context.ts"

// Better Auth freshAge, PLAN §13
export const FRESH_MS = 300_000
const MAX_FAILURES = 5
const STEP_UP_PATH = "/masuk/konfirmasi"
// Admin pages only, never //host
const NEXT = /^\/(?:kelola\/(?:anggota|pengaturan)|admin(?:\/whatsapp)?)$/

/** Valid return path or null. */
export function stepUpNext(value: string | null): string | null {
  return value !== null && NEXT.test(value) ? value : null
}

// Sign-in or TOTP, 300 s
export const FRESH_SESSION = sql<boolean>`greatest(${sessions.createdAt}, coalesce(${sessions.stepUpAt}, ${sessions.createdAt})) > now() - make_interval(secs => ${FRESH_MS / 1000})`

/** TOTP within 300 s. */
export async function isFresh(sessionId: string, db: Db): Promise<boolean> {
  const [row] = await db
    .select({ fresh: FRESH_SESSION })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
  return row?.fresh === true
}

/** Member, settings, campus changes. */
export async function requireFresh(
  context: Readonly<RouterContextProvider>,
  request: Request,
  db: Db = database().db,
): Promise<void> {
  const session = context.get(sessionContext)
  if (!session) throw data(null, { status: 403 })
  // Dev email-only staff
  if (!staffTotpRequired()) return
  if (await isFresh(session.session.id, db)) return
  const next = stepUpNext(new URL(request.url).pathname)
  throw redirect(
    next ? `${STEP_UP_PATH}?ke=${encodeURIComponent(next)}` : STEP_UP_PATH,
  )
}

/** Five misses end the session. */
export async function recordStepUp(
  sessionId: string,
  ok: boolean,
  db: Db = database().db,
  log: (line: LogRecord) => void = writeLog,
): Promise<"ok" | "retry" | "signed_out"> {
  if (ok) {
    await db
      .update(sessions)
      .set({ stepUpAt: sql`now()`, stepUpFailures: 0 })
      .where(eq(sessions.id, sessionId))
    return "ok"
  }
  const [row] = await db
    .update(sessions)
    .set({ stepUpFailures: sql`${sessions.stepUpFailures} + 1` })
    .where(eq(sessions.id, sessionId))
    .returning({ failures: sessions.stepUpFailures })
  const failures = row?.failures ?? MAX_FAILURES
  const kill = failures >= MAX_FAILURES
  log(
    securityRecord(kill ? "step_up_signed_out" : "step_up_failed", {
      session_id: sessionId,
      failures,
    }),
  )
  if (!kill) return "retry"
  // Stolen cookie gets five tries
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return "signed_out"
}

export type StepUpData = { error: "format" | "wrong" } | undefined

const CODE = /^\d{6}$/

type Rotated = { sessionId: string; setCookie: string[] }

/** Verifies TOTP for this session. */
export async function confirmStepUp(input: {
  request: Request
  sessionId: string
  next: string | null
  verify: (code: string) => Promise<boolean>
  // ASVS V7.2.4: new token
  rotate: () => Promise<Rotated>
  db?: Db
}): Promise<StepUpData | Response> {
  const form = await input.request.formData()
  const code = String(form.get("code") ?? "").replace(/\s+/g, "")
  if (!CODE.test(code)) return { error: "format" }
  const ok = await input.verify(code)
  if (ok) {
    const rotated = await input.rotate()
    await recordStepUp(rotated.sessionId, true, input.db)
    const headers = new Headers()
    for (const cookie of rotated.setCookie) headers.append("Set-Cookie", cookie)
    return redirect(input.next ?? "/kelola", { status: 303, headers })
  }
  const outcome = await recordStepUp(input.sessionId, false, input.db)
  if (outcome === "signed_out") return redirect("/masuk", 303)
  return { error: "wrong" }
}

/** Route action, verifies in-process. */
export async function stepUpAction(
  request: Request,
  context: Readonly<RouterContextProvider>,
  auth?: Auth,
): Promise<StepUpData | Response> {
  const session = context.get(sessionContext)
  if (!session) throw redirect("/masuk")
  const api = (auth ?? (await getAuth())).api
  return confirmStepUp({
    request,
    sessionId: session.session.id,
    next: stepUpNext(new URL(request.url).searchParams.get("ke")),
    // Before hook blocks replay
    verify: (code) =>
      api.verifyTOTP({ headers: request.headers, body: { code } }).then(
        () => true,
        () => false,
      ),
    rotate: async () => {
      const rotated = await api.rotateSession({
        headers: request.headers,
        returnHeaders: true,
      })
      return {
        sessionId: rotated.response.id,
        setCookie: rotated.headers.getSetCookie(),
      }
    },
  })
}
