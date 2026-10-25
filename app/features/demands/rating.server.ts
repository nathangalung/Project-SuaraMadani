import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  not,
  sql,
} from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { users } from "../../../db/schema/auth.ts"
import { demandRatings, demands } from "../../../db/schema/demands.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { clientKey } from "../../../server/api/upload.server.ts"
import { addressHash, hashKey, valueHash } from "../../../server/email-log.ts"
import type { PurgeDeps } from "../../../server/purge.server.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import { CLAIM_RULES, ratingAnomaly } from "../../../shared/claims.ts"
import {
  STANDARD_REASONS,
  type StandardReason,
} from "../../../shared/complaints.ts"
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
import type { DemandTenant } from "./manage.server.ts"
import { purgeDemandPages } from "./purge.server.ts"
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

/** Admin flag: one prefix dominates. */
export async function prefixAnomaly(
  tx: Tx,
  demandId: string,
): Promise<boolean> {
  const [stored] = await tx
    .select({ n: demands.maxPrefixRatings })
    .from(demands)
    .where(eq(demands.id, demandId))
  const [totals] = await tx
    .select({ n: count() })
    .from(demandRatings)
    .where(eq(demandRatings.demandId, demandId))
  const [top] = await tx
    .select({ n: count() })
    .from(demandRatings)
    .where(
      and(
        eq(demandRatings.demandId, demandId),
        isNotNull(demandRatings.clientHash),
      ),
    )
    .groupBy(demandRatings.clientHash)
    .orderBy(desc(count()))
    .limit(1)
  return ratingAnomaly({
    total: totals?.n ?? 0,
    // Hashes clear after 30 days
    topPrefix: Math.max(top?.n ?? 0, stored?.n ?? 0),
    young: 0,
  }).prefix
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
    isNull(demandRatings.nameHiddenAt),
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

export type AdminRater = {
  userId: string
  name: string
  score: number
  hidden: boolean
}

/** Opted-in names, admin moderation. */
export function namedRatersForAdmin(
  orgId: string,
  code: string,
): Promise<AdminRater[]> {
  return withTenant(
    orgId,
    async (tx) => {
      const rows = await tx
        .select({
          userId: demandRatings.userId,
          name: users.name,
          score: demandRatings.score,
          hiddenAt: demandRatings.nameHiddenAt,
        })
        .from(demandRatings)
        .innerJoin(demands, eq(demands.id, demandRatings.demandId))
        .innerJoin(users, eq(users.id, demandRatings.userId))
        .where(
          and(
            eq(demands.publicCode, code),
            eq(demandRatings.showName, true),
            sql`btrim(${users.name}) <> ''`,
          ),
        )
        .orderBy(desc(demandRatings.updatedAt), desc(demandRatings.userId))
      return rows.map((row) => ({
        userId: row.userId,
        name: row.name.trim(),
        score: row.score,
        hidden: row.hiddenAt !== null,
      }))
    },
    { role: "admin" },
  )
}

export type HideRaterResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_allowed" }

/** PRIV-23: name off, rating stays. */
export async function hideRaterName(
  tenant: Pick<DemandTenant, "id" | "host">,
  input: {
    code: string
    userId: string
    reason: StandardReason
    actorId: string
  },
  deps: PurgeDeps = {},
): Promise<HideRaterResult> {
  if (!(STANDARD_REASONS as readonly string[]).includes(input.reason)) {
    return { ok: false, reason: "not_allowed" }
  }
  const done = await withTenant(
    tenant.id,
    async (tx) => {
      const [demand] = await tx
        .select({ id: demands.id, version: demands.version })
        .from(demands)
        .where(eq(demands.publicCode, input.code))
      if (!demand) return null
      const [hidden] = await tx
        .update(demandRatings)
        .set({ nameHiddenAt: sql`now()` })
        .where(
          and(
            eq(demandRatings.demandId, demand.id),
            eq(demandRatings.userId, input.userId),
            isNull(demandRatings.nameHiddenAt),
          ),
        )
        .returning({ userId: demandRatings.userId })
      if (!hidden) return null
      // Raw code, labels.ts is frontend
      await tx.insert(auditLog).values({
        orgId: tenant.id,
        actorId: input.actorId,
        action: "demand.rater_hide",
        entityType: "demand",
        entityId: demand.id,
        changedColumns: ["name_hidden_at"],
        // Which rater, keyed hash
        valueHashes: { user_id: { old: valueHash(input.userId, hashKey()) } },
        reasonCode: input.reason,
      })
      return demand
    },
    { role: "admin" },
  )
  if (!done) return { ok: false, reason: "not_found" }
  await purgeDemandPages(
    tenant.host,
    { code: input.code, version: done.version },
    deps,
  )
  return { ok: true }
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
  // One address prefix is full
  | "prefix_cap"

export type RateResult =
  | { status: 200; body: { saved: "rated" | "withdrawn" } }
  | { status: 400; body: { errors: RatingErrorKey[] } }
  | { status: 401 | 403 | 404 | 409 | 429; body: { error: RateFailure } }

export type RateDeps = {
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
  hashKey: () => Buffer
}

type Written = "saved" | "not_found" | "closed" | "prefix_cap"

async function writeRating(
  tx: Tx,
  orgId: string,
  code: string,
  userId: string,
  input: RatingInput | null,
  clientHash: string | null,
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
  if (clientHash) {
    // Serialises one prefix per demand
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${demand.id}|${clientHash}`}, 4))`,
    )
    const [same] = await tx
      .select({ n: count() })
      .from(demandRatings)
      .where(
        and(
          eq(demandRatings.demandId, demand.id),
          eq(demandRatings.clientHash, clientHash),
          not(eq(demandRatings.userId, userId)),
        ),
      )
    if ((same?.n ?? 0) >= CLAIM_RULES.prefixCap) return "prefix_cap"
  }
  await tx
    .insert(demandRatings)
    .values({ orgId, demandId: demand.id, userId, clientHash, ...input })
    .onConflictDoUpdate({
      target: [
        demandRatings.orgId,
        demandRatings.demandId,
        demandRatings.userId,
      ],
      set: { ...input, clientHash, updatedAt: sql`now()` },
    })
  return "saved"
}

function fail(status: 401 | 403 | 404 | 409 | 429, error: RateFailure) {
  return { status, body: { error } } as const
}

const WRITTEN_FAILURE = {
  not_found: fail(404, "not_found"),
  closed: fail(409, "closed"),
  prefix_cap: fail(429, "prefix_cap"),
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
      writeRating(tx, tenant.id, input.code, userId, null, null),
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
  const clientHash = addressHash(
    clientKey(input.remoteIp),
    input.deps.hashKey(),
  )
  const written = await withTenant(tenant.id, (tx) =>
    writeRating(tx, tenant.id, input.code, userId, checked.input, clientHash),
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
      hashKey,
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
