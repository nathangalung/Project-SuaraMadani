import { eq, sql } from "drizzle-orm"
import { data, type RouterContextProvider, redirect } from "react-router"
import { type Db, database } from "../../../db/client.server.ts"
import { sessions } from "../../../db/schema/auth.ts"
import { getAuth } from "../../../server/auth.server.ts"
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

/** TOTP within 300 s. */
async function isFresh(sessionId: string, db: Db): Promise<boolean> {
  const [row] = await db
    .select({
      fresh: sql<boolean>`greatest(${sessions.createdAt}, coalesce(${sessions.stepUpAt}, ${sessions.createdAt})) > now() - make_interval(secs => ${FRESH_MS / 1000})`,
    })
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
  if ((row?.failures ?? MAX_FAILURES) < MAX_FAILURES) return "retry"
  // Stolen cookie gets five tries
  await db.delete(sessions).where(eq(sessions.id, sessionId))
  return "signed_out"
}

export type StepUpData = { error: "format" | "wrong" } | undefined

const CODE = /^\d{6}$/

/** Verifies TOTP for this session. */
export async function confirmStepUp(input: {
  request: Request
  sessionId: string
  next: string | null
  verify: (code: string) => Promise<boolean>
  db?: Db
}): Promise<StepUpData | Response> {
  const form = await input.request.formData()
  const code = String(form.get("code") ?? "").replace(/\s+/g, "")
  if (!CODE.test(code)) return { error: "format" }
  const ok = await input.verify(code)
  const outcome = await recordStepUp(input.sessionId, ok, input.db)
  if (outcome === "ok") return redirect(input.next ?? "/kelola", 303)
  if (outcome === "signed_out") return redirect("/masuk", 303)
  return { error: "wrong" }
}

/** Route action, verifies in-process. */
export async function stepUpAction(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<StepUpData | Response> {
  const session = context.get(sessionContext)
  if (!session) throw redirect("/masuk")
  const api = (await getAuth()).api
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
  })
}
