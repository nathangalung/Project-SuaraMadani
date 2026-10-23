import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { users } from "../../../db/schema/auth.ts"
import { demandRankings, demands } from "../../../db/schema/demands.ts"
import { regions } from "../../../db/schema/regions.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import {
  type CitizenRanking,
  citizenRanking,
  type DemandCategory,
  type DemandScope,
  RANKING_ACCOUNT_DAYS,
  RANKING_SIZE,
} from "../../../shared/demands.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { text, UUID } from "../moderation/form-values.ts"
import { checkRanking, type RankingErrorKey } from "./ranking-form.ts"

// Read time, counts later
const COUNTED = sql`${users.createdAt} <= now() - ${RANKING_ACCOUNT_DAYS}::int * interval '1 day'`

/** Borda over published tuntutan. */
export async function readCitizenRanking(tx: Tx): Promise<CitizenRanking> {
  const rows = await tx
    .select({
      demandId: demands.id,
      raisedOn: demands.raisedOn,
      points: sql<number>`coalesce(sum(${RANKING_SIZE + 1} - ${demandRankings.position}), 0)::int`,
      rankers: sql<number>`count(${demandRankings.userId})::int`,
    })
    .from(demands)
    .innerJoin(
      demandRankings,
      and(
        eq(demandRankings.orgId, demands.orgId),
        eq(demandRankings.demandId, demands.id),
      ),
    )
    .innerJoin(users, eq(users.id, demandRankings.userId))
    .where(and(eq(demands.state, "published"), COUNTED))
    .groupBy(demands.id, demands.raisedOn)
  const [total] = await tx
    .select({
      n: sql<number>`count(DISTINCT ${demandRankings.userId})::int`,
    })
    .from(demandRankings)
    .innerJoin(users, eq(users.id, demandRankings.userId))
    .innerJoin(
      demands,
      and(
        eq(demands.orgId, demandRankings.orgId),
        eq(demands.id, demandRankings.demandId),
      ),
    )
    .where(and(eq(demands.state, "published"), COUNTED))
  return citizenRanking(rows, total?.n ?? 0)
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
    return {
      choices: rows.map(({ id, ...row }) => ({
        ...row,
        position: positions.get(id) ?? null,
      })),
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

/** Replace the whole list. */
async function writeRanking(
  tx: Tx,
  orgId: string,
  userId: string,
  codes: readonly string[] | null,
): Promise<"saved" | "not_found"> {
  await tx.delete(demandRankings).where(eq(demandRankings.userId, userId))
  if (!codes) return "saved"
  const rows = await tx
    .select({ id: demands.id, code: demands.publicCode })
    .from(demands)
    .where(
      and(
        inArray(demands.publicCode, [...codes]),
        eq(demands.state, "published"),
      ),
    )
  const ids = new Map(rows.map((row) => [row.code, row.id]))
  // Every pick must be open
  if (ids.size !== codes.length) return "not_found"
  await tx.insert(demandRankings).values(
    codes.map((code, index) => ({
      orgId,
      userId,
      demandId: ids.get(code) as string,
      position: index + 1,
    })),
  )
  return "saved"
}

type RankFailure = "sign_in_required" | "captcha_failed" | "not_found"

export type RankResult =
  | { status: 200; body: { saved: "ranked" | "withdrawn" } }
  | { status: 400; body: { errors: RankingErrorKey[] } }
  | { status: 401 | 403 | 404; body: { error: RankFailure } }

export type RankDeps = {
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
}

function fail(status: 401 | 403 | 404, error: RankFailure) {
  return { status, body: { error } } as const
}

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
  if (checked.codes.length > RANKING_SIZE) {
    return { status: 400, body: { errors: ["duplicate"] } }
  }
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
  const written = await withTenant(tenant.id, (tx) =>
    writeRanking(tx, tenant.id, userId, checked.codes),
  )
  if (written !== "saved") return fail(404, "not_found")
  return { status: 200, body: { saved: "ranked" } }
}

// Form fields only
const MAX_BODY_BYTES = 8 * 1024

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
    },
  })
}
