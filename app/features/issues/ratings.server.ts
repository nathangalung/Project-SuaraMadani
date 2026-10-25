import { and, eq, sql } from "drizzle-orm"
import { users } from "../../../db/schema/auth.ts"
import { ratings } from "../../../db/schema/claims.ts"
import {
  issueReports,
  issues,
  resolutionClaims,
} from "../../../db/schema/issues.ts"
import { reports } from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { clientKey } from "../../../server/api/upload.server.ts"
import { addressHash, hashKey } from "../../../server/email-log.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import {
  CLAIM_RULES,
  isRatingScore,
  type RatingScore,
} from "../../../shared/claims.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { text, UUID } from "../moderation/form-values.ts"

type RateFailure =
  | "sign_in_required"
  | "captcha_failed"
  | "not_found"
  | "closed"
  | "already_rated"
  | "prefix_cap"

export type RateClaimResult =
  | { status: 201 | 200; body: { saved: "rated" } }
  | { status: 400; body: { errors: ["score"] | [] } }
  | { status: 401 | 403 | 404 | 409 | 429; body: { error: RateFailure } }

export type RateClaimDeps = {
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
  hashKey: () => Buffer
}

function fail(status: 401 | 403 | 404 | 409 | 429, error: RateFailure) {
  return { status, body: { error } } as const
}

type Target = { issueId: string; claimId: string | null }

/** Published issue, its open claim. */
async function findTarget(tx: Tx, code: string): Promise<Target | null> {
  const [row] = await tx
    .select({ issueId: issues.id, claimId: resolutionClaims.id })
    .from(issues)
    .leftJoin(
      resolutionClaims,
      and(
        eq(resolutionClaims.orgId, issues.orgId),
        eq(resolutionClaims.issueId, issues.id),
        sql`${resolutionClaims.closedAt} IS NULL`,
        eq(issues.govStatus, "claimed_resolved"),
      ),
    )
    .where(
      and(eq(issues.publicCode, code), sql`${issues.publishedAt} IS NOT NULL`),
    )
    .limit(1)
  return row ?? null
}

/** Own score, current round. */
export function ownClaimRating(
  orgId: string,
  code: string,
  userId: string,
): Promise<RatingScore | null> {
  return withTenant(orgId, async (tx) => {
    const target = await findTarget(tx, code)
    if (!target?.claimId) return null
    const [row] = await tx
      .select({ score: ratings.score })
      .from(ratings)
      .where(
        and(eq(ratings.claimId, target.claimId), eq(ratings.userId, userId)),
      )
    return row && isRatingScore(row.score) ? row.score : null
  })
}

type Written = "rated" | "not_found" | "closed" | "already_rated" | "prefix_cap"

async function writeRating(
  tx: Tx,
  input: {
    orgId: string
    code: string
    userId: string
    score: RatingScore
    clientHash: string
  },
): Promise<Written> {
  const target = await findTarget(tx, input.code)
  if (!target) return "not_found"
  const { claimId } = target
  if (!claimId) return "closed"
  // Serialises one prefix per claim
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${claimId}|${input.clientHash}`}, 2))`,
  )
  const [same] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ratings)
    .where(
      and(
        eq(ratings.claimId, claimId),
        eq(ratings.clientHash, input.clientHash),
      ),
    )
  if ((same?.n ?? 0) >= CLAIM_RULES.prefixCap) return "prefix_cap"
  const reporter = sql`EXISTS (
    SELECT 1 FROM ${issueReports}
    JOIN ${reports} ON ${reports.orgId} = ${issueReports.orgId}
      AND ${reports.id} = ${issueReports.reportId}
    WHERE ${issueReports.issueId} = ${target.issueId}
      AND ${reports.userId} = ${input.userId})`
  // Gate and write, one statement
  const inserted = await tx.execute<{ claim_id: string }>(sql`
    INSERT INTO ${ratings} (org_id, claim_id, user_id, score, is_reporter, account_days, client_hash)
    SELECT ${input.orgId}, ${claimId}, ${input.userId}, ${input.score}, ${reporter},
      floor(extract(epoch FROM now() - ${users.createdAt}) / 86400)::int,
      ${input.clientHash}
    FROM ${users}
    WHERE ${users.id} = ${input.userId}
      AND EXISTS (
        SELECT 1 FROM ${resolutionClaims}
        JOIN ${issues} ON ${issues.orgId} = ${resolutionClaims.orgId}
          AND ${issues.id} = ${resolutionClaims.issueId}
        WHERE ${resolutionClaims.id} = ${claimId}
          AND ${resolutionClaims.closedAt} IS NULL
          AND ${issues.govStatus} = 'claimed_resolved'
          AND ${issues.publishedAt} IS NOT NULL)
    ON CONFLICT DO NOTHING
    RETURNING claim_id`)
  if (inserted.rows.length > 0) return "rated"
  const [own] = await tx
    .select({ score: ratings.score })
    .from(ratings)
    .where(and(eq(ratings.claimId, claimId), eq(ratings.userId, input.userId)))
  return own ? "already_rated" : "closed"
}

const WRITTEN_FAILURE = {
  not_found: fail(404, "not_found"),
  closed: fail(409, "closed"),
  already_rated: fail(409, "already_rated"),
  prefix_cap: fail(429, "prefix_cap"),
} as const

/** One per account per claim. */
export async function rateClaim(input: {
  tenant: TenantContext
  session: SessionContext | null
  code: string
  form: FormData
  remoteIp: string | null
  deps: RateClaimDeps
}): Promise<RateClaimResult> {
  const { tenant, session, form } = input
  if (!session) return fail(401, "sign_in_required")
  const submissionId = text(form, "submissionId")
  if (text(form, "intent") !== "rate" || !UUID.test(submissionId)) {
    return { status: 400, body: { errors: [] } }
  }
  const raw = text(form, "score")
  const score = /^[1-5]$/.test(raw) ? Number(raw) : 0
  if (!isRatingScore(score)) return { status: 400, body: { errors: ["score"] } }
  const userId = session.user.id
  const captcha = await input.deps.verifyCaptcha(
    text(form, "turnstileToken") || null,
    input.remoteIp,
    submissionId,
  )
  if (!captcha.ok) {
    // Loser of a double submit
    if (
      captcha.reason === "duplicate" &&
      (await ownClaimRating(tenant.id, input.code, userId)) === score
    ) {
      return { status: 200, body: { saved: "rated" } }
    }
    return fail(403, "captcha_failed")
  }
  const clientHash = addressHash(
    clientKey(input.remoteIp),
    input.deps.hashKey(),
  )
  const written = await withTenant(tenant.id, (tx) =>
    writeRating(tx, {
      orgId: tenant.id,
      code: input.code,
      userId,
      score,
      clientHash,
    }),
  )
  if (written !== "rated") return WRITTEN_FAILURE[written]
  return { status: 201, body: { saved: "rated" } }
}

// Form fields only
const MAX_BODY_BYTES = 8 * 1024

/** Route action wiring, real Turnstile. */
export async function rateClaimRequest(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
  code: string
}): Promise<RateClaimResult | { status: 413 }> {
  const { request } = input
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: 413 }
  }
  return rateClaim({
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
