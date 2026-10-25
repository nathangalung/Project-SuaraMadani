import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  sql,
} from "drizzle-orm"
import { users } from "../../../db/schema/auth.ts"
import { demandRankings, demands } from "../../../db/schema/demands.ts"
import { regions } from "../../../db/schema/regions.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { clientKey } from "../../../server/api/upload.server.ts"
import { addressHash, hashKey } from "../../../server/email-log.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import { CLAIM_RULES, ratingAnomaly } from "../../../shared/claims.ts"
import {
  type CitizenRanking,
  citizenRanking,
  type DemandCategory,
  type DemandScope,
  RANKING_ACCOUNT_DAYS,
} from "../../../shared/demands.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { text, UUID } from "../moderation/form-values.ts"
import { checkRanking, type RankingErrorKey } from "./ranking-form.ts"

// Read time, counts later
const COUNTED = sql`${users.createdAt} <= now() - ${RANKING_ACCOUNT_DAYS}::int * interval '1 day'`

/** Published Borda, one statement. */
export async function readCitizenRanking(tx: Tx): Promise<CitizenRanking> {
  // Own N, old lists too
  const lists = tx
    .select({
      userId: demandRankings.userId,
      size: sql<number>`count(*)::int`.as("size"),
    })
    .from(demandRankings)
    .groupBy(demandRankings.userId)
    .as("lists")
  const rows = await tx
    .select({
      // Grand total row
      isTotal: sql<boolean>`grouping(${demands.id}) = 1`,
      demandId: demands.id,
      raisedOn: demands.raisedOn,
      points: sql<number>`coalesce(sum(${lists.size} + 1 - ${demandRankings.position}), 0)::int`,
      rankers: sql<number>`count(DISTINCT ${demandRankings.userId})::int`,
    })
    .from(demands)
    .innerJoin(
      demandRankings,
      and(
        eq(demandRankings.orgId, demands.orgId),
        eq(demandRankings.demandId, demands.id),
      ),
    )
    .innerJoin(lists, eq(lists.userId, demandRankings.userId))
    .innerJoin(users, eq(users.id, demandRankings.userId))
    .where(and(eq(demands.state, "published"), COUNTED))
    .groupBy(sql`GROUPING SETS ((${demands.id}, ${demands.raisedOn}), ())`)
  const total = rows.find((row) => row.isTotal)?.rankers ?? 0
  return citizenRanking(
    rows.filter((row) => !row.isTotal),
    total,
  )
}

/** Top places, threshold met. */
export async function readTopRanked(tx: Tx, limit: number): Promise<string[]> {
  const ranking = await readCitizenRanking(tx)
  if (!ranking.shown) return []
  return [...ranking.places.entries()]
    .filter(([, rank]) => rank.place !== null)
    .toSorted(([, a], [, b]) => (a.place ?? 0) - (b.place ?? 0))
    .slice(0, limit)
    .map(([id]) => id)
}

/** Admin: lists not counted. */
export async function pendingRankers(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({
      n: sql<number>`count(DISTINCT ${demandRankings.userId})::int`,
    })
    .from(demandRankings)
    .innerJoin(users, eq(users.id, demandRankings.userId))
    .where(sql`NOT (${COUNTED})`)
  return row?.n ?? 0
}

/** Admin flag: one prefix dominates. */
export async function rankingPrefixAnomaly(
  tx: Tx,
  demandId: string,
): Promise<boolean> {
  const [stored] = await tx
    .select({ n: demands.maxPrefixRankings })
    .from(demands)
    .where(eq(demands.id, demandId))
  const [total] = await tx
    .select({ n: count() })
    .from(demandRankings)
    .where(eq(demandRankings.demandId, demandId))
  const [top] = await tx
    .select({ n: count() })
    .from(demandRankings)
    .where(
      and(
        eq(demandRankings.demandId, demandId),
        isNotNull(demandRankings.clientHash),
      ),
    )
    .groupBy(demandRankings.clientHash)
    .orderBy(desc(count()))
    .limit(1)
  return ratingAnomaly({
    total: total?.n ?? 0,
    // Hashes clear after 30 days
    topPrefix: Math.max(top?.n ?? 0, stored?.n ?? 0),
    young: 0,
  }).prefix
}

export type RankingChoice = {
  code: string
  title: string
  scope: DemandScope
  provinceName: string | null
  category: DemandCategory | null
  // Own position or null
  position: number | null
}

export type OwnRankingPage = {
  choices: RankingChoice[]
  // Own list exists
  saved: boolean
  // False until account ages
  counted: boolean
}

/** Published tuntutan, own order. */
export function rankingPage(
  orgId: string,
  userId: string | null,
): Promise<OwnRankingPage> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({
        id: demands.id,
        code: demands.publicCode,
        title: demands.title,
        scope: demands.scope,
        provinceName: regions.name,
        category: demands.category,
      })
      .from(demands)
      .leftJoin(regions, eq(regions.code, demands.provinceCode))
      .where(eq(demands.state, "published"))
      .orderBy(asc(demands.title))
    const own = userId
      ? await tx
          .select({
            demandId: demandRankings.demandId,
            position: demandRankings.position,
          })
          .from(demandRankings)
          .where(eq(demandRankings.userId, userId))
      : []
    const positions = new Map(own.map((row) => [row.demandId, row.position]))
    const [account] = userId
      ? await tx
          .select({ counted: sql<boolean>`${COUNTED}` })
          .from(users)
          .where(eq(users.id, userId))
      : []
    // Own order first, then title
    const choices = rows
      .map(({ id, ...row }) => ({
        ...row,
        position: positions.get(id) ?? null,
      }))
      .toSorted(
        (a, b) =>
          (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER),
      )
      // Close gaps from closed ones
      .map((choice, index) => ({
        ...choice,
        position: choice.position === null ? null : index + 1,
      }))
    return {
      choices,
      saved: own.length > 0,
      counted: account?.counted ?? false,
    }
  })
}

/** Saved list, in order. */
function ownCodes(orgId: string, userId: string): Promise<string[]> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({ code: demands.publicCode })
      .from(demandRankings)
      .innerJoin(
        demands,
        and(
          eq(demands.orgId, demandRankings.orgId),
          eq(demands.id, demandRankings.demandId),
        ),
      )
      .where(eq(demandRankings.userId, userId))
      .orderBy(asc(demandRankings.position))
    return rows.map((row) => row.code)
  })
}

export type OwnPosition = {
  position: number | null
  // Has any list
  saved: boolean
  counted: boolean
}

/** Own place for one tuntutan. */
export function ownPosition(
  orgId: string,
  code: string,
  userId: string,
): Promise<OwnPosition> {
  return withTenant(orgId, async (tx) => {
    const rows = await tx
      .select({
        code: demands.publicCode,
        position: demandRankings.position,
        counted: sql<boolean>`${COUNTED}`,
      })
      .from(demandRankings)
      .innerJoin(
        demands,
        and(
          eq(demands.orgId, demandRankings.orgId),
          eq(demands.id, demandRankings.demandId),
        ),
      )
      .innerJoin(users, eq(users.id, demandRankings.userId))
      .where(eq(demandRankings.userId, userId))
    return {
      position: rows.find((row) => row.code === code)?.position ?? null,
      saved: rows.length > 0,
      counted: rows[0]?.counted ?? false,
    }
  })
}

type Written = "saved" | "not_found" | "prefix_cap"

/** Replace the whole list. */
async function writeRanking(
  tx: Tx,
  orgId: string,
  userId: string,
  // Null withdraws the list
  list: { codes: readonly string[]; clientHash: string } | null,
): Promise<Written> {
  // One save per account
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 4))`,
  )
  const own = eq(demandRankings.userId, userId)
  if (!list) {
    await tx.delete(demandRankings).where(own)
    return "saved"
  }
  const { codes, clientHash } = list
  const rows = await tx
    .select({ id: demands.id, code: demands.publicCode })
    .from(demands)
    .where(eq(demands.state, "published"))
  const ids = new Map(rows.map((row) => [row.code, row.id]))
  // Exactly the published set
  if (ids.size !== codes.length || codes.some((code) => !ids.has(code))) {
    return "not_found"
  }
  // Serialises one prefix per campus
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}|${clientHash}`}, 5))`,
  )
  const [full] = await tx
    .select({ demandId: demandRankings.demandId })
    .from(demandRankings)
    .where(
      and(
        inArray(demandRankings.demandId, [...ids.values()]),
        eq(demandRankings.clientHash, clientHash),
        ne(demandRankings.userId, userId),
      ),
    )
    .groupBy(demandRankings.demandId)
    .having(sql`count(*) >= ${CLAIM_RULES.prefixCap}`)
    .limit(1)
  if (full) return "prefix_cap"
  await tx.delete(demandRankings).where(own)
  await tx.insert(demandRankings).values(
    codes.map((code, index) => ({
      orgId,
      userId,
      demandId: ids.get(code) as string,
      position: index + 1,
      clientHash,
    })),
  )
  return "saved"
}

type RankFailure =
  | "sign_in_required"
  | "captcha_failed"
  | "not_found"
  // One address prefix is full
  | "prefix_cap"

export type RankResult =
  | { status: 200; body: { saved: "ranked" | "withdrawn" } }
  | { status: 400; body: { errors: RankingErrorKey[] } }
  | { status: 401 | 403 | 404 | 429; body: { error: RankFailure } }

export type RankDeps = {
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
  hashKey: () => Buffer
}

function fail(status: 401 | 403 | 404 | 429, error: RankFailure) {
  return { status, body: { error } } as const
}

const WRITTEN_FAILURE = {
  not_found: fail(404, "not_found"),
  prefix_cap: fail(429, "prefix_cap"),
} as const

/** One list per account, Turnstile. */
export async function rankDemands(input: {
  tenant: TenantContext
  session: SessionContext | null
  form: FormData
  remoteIp: string | null
  deps: RankDeps
}): Promise<RankResult> {
  const { tenant, session, form } = input
  if (!session) return fail(401, "sign_in_required")
  const userId = session.user.id
  const intent = text(form, "intent")
  if (intent === "withdraw") {
    await withTenant(tenant.id, (tx) =>
      writeRanking(tx, tenant.id, userId, null),
    )
    return { status: 200, body: { saved: "withdrawn" } }
  }
  const submissionId = text(form, "submissionId")
  if (intent !== "rank" || !UUID.test(submissionId)) {
    return { status: 400, body: { errors: [] } }
  }
  const checked = checkRanking(form.entries())
  if (!checked.ok) return { status: 400, body: { errors: checked.errors } }
  const captcha = await input.deps.verifyCaptcha(
    text(form, "turnstileToken") || null,
    input.remoteIp,
    submissionId,
  )
  if (!captcha.ok) {
    // Loser of a double submit
    if (captcha.reason === "duplicate") {
      const saved = await ownCodes(tenant.id, userId)
      if (saved.join() === checked.codes.join()) {
        return { status: 200, body: { saved: "ranked" } }
      }
    }
    return fail(403, "captcha_failed")
  }
  const clientHash = addressHash(
    clientKey(input.remoteIp),
    input.deps.hashKey(),
  )
  const written = await withTenant(tenant.id, (tx) =>
    writeRanking(tx, tenant.id, userId, {
      codes: checked.codes,
      clientHash,
    }),
  )
  if (written !== "saved") return WRITTEN_FAILURE[written]
  return { status: 200, body: { saved: "ranked" } }
}

// About 1,800 longest codes
const MAX_BODY_BYTES = 64 * 1024

/** Route action wiring, real Turnstile. */
export async function rankRequest(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
}): Promise<RankResult | { status: 413 }> {
  const { request } = input
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: 413 }
  }
  return rankDemands({
    tenant: input.tenant,
    session: input.session,
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
