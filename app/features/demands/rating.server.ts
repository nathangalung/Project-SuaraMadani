import { and, count, desc, eq, inArray, not, sql } from "drizzle-orm"
import { users } from "../../../db/schema/auth.ts"
import { demandRatings, demands } from "../../../db/schema/demands.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import {
  emptyImportance,
  IMPORTANCE_ACCOUNT_DAYS,
  IMPORTANCE_MIN_RATERS,
  IMPORTANCE_NAMES_SHOWN,
  type Importance,
  type ImportanceScore,
  importanceOf,
  isImportanceScore,
} from "../../../shared/demands.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { text, UUID } from "../moderation/form-values.ts"
import {
  checkRating,
  type RatingErrorKey,
  type RatingInput,
} from "./rating-form.ts"

// Read time, counts later
const COUNTED = sql`${users.createdAt} <= now() - ${IMPORTANCE_ACCOUNT_DAYS}::int * interval '1 day'`

/** Counted ratings per demand. */
export async function readImportance(
  tx: Tx,
  demandIds: readonly string[],
): Promise<Map<string, Importance>> {
  if (demandIds.length === 0) return new Map()
  const rows = await tx
    .select({
      demandId: demandRatings.demandId,
      score: demandRatings.score,
      n: sql<number>`count(*)::int`,
    })
    .from(demandRatings)
    .innerJoin(users, eq(users.id, demandRatings.userId))
    .where(and(inArray(demandRatings.demandId, [...demandIds]), COUNTED))
    .groupBy(demandRatings.demandId, demandRatings.score)
  return new Map(
    demandIds.map((id) => [
      id,
      importanceOf(rows.filter((row) => row.demandId === id)),
    ]),
  )
}

/** Admin view: not counted yet. */
export async function pendingRaters(tx: Tx, demandId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(demandRatings)
    .innerJoin(users, eq(users.id, demandRatings.userId))
    .where(and(eq(demandRatings.demandId, demandId), not(COUNTED)))
  return row?.n ?? 0
}

type NamedRater = { name: string; score: ImportanceScore; on: Date }

export type NamedRaters = { shown: NamedRater[]; total: number }

/** Opted-in names, counted only. */
export async function readNamedRaters(
  tx: Tx,
  demandId: string,
): Promise<NamedRaters> {
  const named = and(
    eq(demandRatings.demandId, demandId),
    eq(demandRatings.showName, true),
    sql`btrim(${users.name}) <> ''`,
    COUNTED,
  )
  const rows = await tx
    .select({
      name: users.name,
      score: demandRatings.score,
      on: demandRatings.updatedAt,
    })
    .from(demandRatings)
    .innerJoin(users, eq(users.id, demandRatings.userId))
    .where(named)
    .orderBy(desc(demandRatings.updatedAt), desc(demandRatings.userId))
    .limit(IMPORTANCE_NAMES_SHOWN)
  const [total] = await tx
    .select({ n: count() })
    .from(demandRatings)
    .innerJoin(users, eq(users.id, demandRatings.userId))
    .where(named)
  return {
    shown: rows.flatMap((row) =>
      isImportanceScore(row.score)
        ? [{ name: row.name.trim(), score: row.score, on: row.on }]
        : [],
    ),
    total: total?.n ?? 0,
  }
}

export type OwnRating = {
  score: ImportanceScore
  showName: boolean
  // False until account ages
  counted: boolean
}

export function ownRating(
  orgId: string,
  code: string,
  userId: string,
): Promise<OwnRating | null> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({
        score: demandRatings.score,
        showName: demandRatings.showName,
        counted: sql<boolean>`${COUNTED}`,
      })
      .from(demandRatings)
      .innerJoin(
        demands,
        and(
          eq(demands.orgId, demandRatings.orgId),
          eq(demands.id, demandRatings.demandId),
        ),
      )
      .innerJoin(users, eq(users.id, demandRatings.userId))
      .where(
        and(eq(demands.publicCode, code), eq(demandRatings.userId, userId)),
      )
      .limit(1)
    if (!row || !isImportanceScore(row.score)) return null
    return { score: row.score, showName: row.showName, counted: row.counted }
  })
}

export type RatingTarget = {
  code: string
  title: string
  // Closed: shown, not rated
  open: boolean
  importance: Importance
}

/** Public demand, or null. */
export function ratingTarget(
  orgId: string,
  code: string,
): Promise<RatingTarget | null> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .select({
        id: demands.id,
        code: demands.publicCode,
        title: demands.title,
        state: demands.state,
      })
      .from(demands)
      .where(
        and(eq(demands.publicCode, code), sql`${demands.state} <> 'draft'`),
      )
      .limit(1)
    if (!row) return null
    const ratings = await readImportance(tx, [row.id])
    return {
      code: row.code,
      title: row.title,
      open: row.state === "published",
      importance: ratings.get(row.id) ?? emptyImportance(),
    }
  })
}

type RateFailure =
  | "sign_in_required"
  | "captcha_failed"
  | "not_found"
  // Closed tuntutan keep their score
  | "closed"

export type RateResult =
  | { status: 200; body: { saved: "rated" | "withdrawn" } }
  | { status: 400; body: { errors: RatingErrorKey[] } }
  | { status: 401 | 403 | 404 | 409; body: { error: RateFailure } }

export type RateDeps = {
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
}

type Written = "saved" | "not_found" | "closed"

async function writeRating(
  tx: Tx,
  orgId: string,
  code: string,
  userId: string,
  input: RatingInput | null,
): Promise<Written> {
  const [demand] = await tx
    .select({ id: demands.id, state: demands.state })
    .from(demands)
    .where(and(eq(demands.publicCode, code), sql`${demands.state} <> 'draft'`))
    .limit(1)
  if (!demand) return "not_found"
  const own = and(
    eq(demandRatings.demandId, demand.id),
    eq(demandRatings.userId, userId),
  )
  // Withdrawing works even when closed
  if (!input) {
    await tx.delete(demandRatings).where(own)
    return "saved"
  }
  if (demand.state !== "published") return "closed"
  await tx
    .insert(demandRatings)
    .values({ orgId, demandId: demand.id, userId, ...input })
    .onConflictDoUpdate({
      target: [
        demandRatings.orgId,
        demandRatings.demandId,
        demandRatings.userId,
      ],
      set: { ...input, updatedAt: sql`now()` },
    })
  return "saved"
}

function fail(status: 401 | 403 | 404 | 409, error: RateFailure) {
  return { status, body: { error } } as const
}

const WRITTEN_FAILURE = {
  not_found: fail(404, "not_found"),
  closed: fail(409, "closed"),
} as const

/** One per account, Turnstile. */
export async function rateDemand(input: {
  tenant: TenantContext
  session: SessionContext | null
  code: string
  form: FormData
  remoteIp: string | null
  deps: RateDeps
}): Promise<RateResult> {
  const { tenant, session, form } = input
  if (!session) return fail(401, "sign_in_required")
  const userId = session.user.id
  const intent = text(form, "intent")
  if (intent === "withdraw") {
    const written = await withTenant(tenant.id, (tx) =>
      writeRating(tx, tenant.id, input.code, userId, null),
    )
    if (written !== "saved") return WRITTEN_FAILURE[written]
    return { status: 200, body: { saved: "withdrawn" } }
  }
  const submissionId = text(form, "submissionId")
  if (intent !== "rate" || !UUID.test(submissionId)) {
    return { status: 400, body: { errors: [] } }
  }
  const checked = checkRating({
    score: text(form, "score"),
    visibility: text(form, "visibility"),
  })
  if (!checked.ok) return { status: 400, body: { errors: checked.errors } }
  const captcha = await input.deps.verifyCaptcha(
    text(form, "turnstileToken") || null,
    input.remoteIp,
    submissionId,
  )
  if (!captcha.ok) {
    // Loser of a double submit
    if (captcha.reason === "duplicate") {
      const saved = await ownRating(tenant.id, input.code, userId)
      if (
        saved?.score === checked.input.score &&
        saved.showName === checked.input.showName
      ) {
        return { status: 200, body: { saved: "rated" } }
      }
    }
    return fail(403, "captcha_failed")
  }
  const written = await withTenant(tenant.id, (tx) =>
    writeRating(tx, tenant.id, input.code, userId, checked.input),
  )
  if (written !== "saved") return WRITTEN_FAILURE[written]
  return { status: 200, body: { saved: "rated" } }
}

// Form fields only
const MAX_BODY_BYTES = 8 * 1024

/** Route action wiring, real Turnstile. */
export async function rateRequest(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
  code: string
}): Promise<RateResult | { status: 413 }> {
  const { request } = input
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: 413 }
  }
  return rateDemand({
    tenant: input.tenant,
    session: input.session,
    code: input.code,
    form: await request.formData(),
    remoteIp: request.headers.get("x-client-ip"),
    deps: {
      verifyCaptcha: (token, ip, idempotencyKey) =>
        verifyTurnstile(token, {
          secret: turnstileSecret(),
          remoteIp: ip,
          idempotencyKey,
        }),
    },
  })
}

/** Highest mean, enough raters. */
export async function readTopImportant(
  tx: Tx,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: demandRatings.demandId })
    .from(demandRatings)
    .innerJoin(users, eq(users.id, demandRatings.userId))
    .innerJoin(
      demands,
      and(
        eq(demands.orgId, demandRatings.orgId),
        eq(demands.id, demandRatings.demandId),
      ),
    )
    .where(and(eq(demands.state, "published"), COUNTED))
    .groupBy(demandRatings.demandId)
    .having(sql`count(*) >= ${IMPORTANCE_MIN_RATERS}`)
    // Shown mean, then raters
    .orderBy(
      sql`round(avg(${demandRatings.score}), 1) DESC`,
      sql`count(*) DESC`,
      desc(demandRatings.demandId),
    )
    .limit(limit)
  return rows.map((row) => row.id)
}
