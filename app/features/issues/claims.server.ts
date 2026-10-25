import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { fixSurveys, ratings } from "../../../db/schema/claims.ts"
import { issues, resolutionClaims } from "../../../db/schema/issues.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import {
  CLAIM_RULES,
  type ClaimBasis,
  type ClaimDistribution,
  type ClaimOutcome,
  claimDistribution,
  ratingAnomaly,
  type SurveyTally,
  surveySupportsConfirm,
} from "../../../shared/claims.ts"

type ClaimRecord = {
  id: string
  claimedAt: Date
  closedAt: Date | null
  outcome: ClaimOutcome | null
  basis: ClaimBasis | null
  // Admin confirm proof, public
  evidenceUrl: string | null
}

type ClaimRatings = {
  reporters: ClaimDistribution
  // Accounts 7 days or older
  others: ClaimDistribution
}

const COUNTED = sql`(${ratings.isReporter} OR ${ratings.accountDays} >= ${CLAIM_RULES.accountDays})`

/** Counted ratings, two groups. */
async function readClaimRatings(
  tx: Tx,
  claimId: string,
): Promise<ClaimRatings> {
  const rows = await tx
    .select({
      reporter: ratings.isReporter,
      score: ratings.score,
      n: sql<number>`count(*)::int`,
    })
    .from(ratings)
    .where(and(eq(ratings.claimId, claimId), COUNTED))
    .groupBy(ratings.isReporter, ratings.score)
  return {
    reporters: claimDistribution(rows.filter((row) => row.reporter)),
    others: claimDistribution(rows.filter((row) => !row.reporter)),
  }
}

/** Invited, fixed, not fixed. */
export async function surveyTally(
  tx: Tx,
  claimId: string,
): Promise<SurveyTally> {
  const [row] = await tx
    .select({
      invited: sql<number>`count(*)::int`,
      fixed: sql<number>`count(*) FILTER (WHERE ${fixSurveys.answer} = 'fixed')::int`,
      notFixed: sql<number>`count(*) FILTER (WHERE ${fixSurveys.answer} = 'not_fixed')::int`,
    })
    .from(fixSurveys)
    .where(eq(fixSurveys.claimId, claimId))
  return row ?? { invited: 0, fixed: 0, notFixed: 0 }
}

async function readClaims(tx: Tx, issueId: string): Promise<ClaimRecord[]> {
  return tx
    .select({
      id: resolutionClaims.id,
      claimedAt: resolutionClaims.claimedAt,
      closedAt: resolutionClaims.closedAt,
      outcome: resolutionClaims.outcome,
      basis: resolutionClaims.basis,
      evidenceUrl: resolutionClaims.evidenceUrl,
    })
    .from(resolutionClaims)
    .where(eq(resolutionClaims.issueId, issueId))
    .orderBy(desc(resolutionClaims.claimedAt), desc(resolutionClaims.id))
}

export type ClaimSection = {
  // Newest first
  claims: ClaimRecord[]
  // Only while "Diklaim selesai"
  current: { claimId: string; ratings: ClaimRatings } | null
}

/** Public issue page part. */
export function claimSection(
  orgId: string,
  code: string,
): Promise<ClaimSection | null> {
  return withTenant(orgId, async (tx) => {
    const [issue] = await tx
      .select({ id: issues.id, gov: issues.govStatus })
      .from(issues)
      .where(and(eq(issues.publicCode, code), isNotNull(issues.publishedAt)))
      .limit(1)
    if (!issue) return null
    const claims = await readClaims(tx, issue.id)
    const open = claims.find((claim) => claim.closedAt === null)
    const current =
      open && issue.gov === "claimed_resolved"
        ? { claimId: open.id, ratings: await readClaimRatings(tx, open.id) }
        : null
    return { claims, current }
  })
}

export type ClaimReview = {
  claimId: string
  survey: SurveyTally
  // Basis for an admin confirm
  supportsConfirm: boolean
  ratings: ClaimRatings
  // Under 7 days, never counted
  excluded: number
  anomaly: { prefix: boolean; young: boolean }
}

/** Admin issue page, open claim. */
export function claimReview(
  orgId: string,
  issueId: string,
): Promise<ClaimReview | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const [open] = await tx
        .select({
          id: resolutionClaims.id,
          maxPrefix: resolutionClaims.maxPrefixRatings,
        })
        .from(resolutionClaims)
        .where(
          and(
            eq(resolutionClaims.issueId, issueId),
            isNull(resolutionClaims.closedAt),
          ),
        )
        .limit(1)
      if (!open) return null
      const survey = await surveyTally(tx, open.id)
      const [totals] = await tx
        .select({
          total: count(),
          young: sql<number>`count(*) FILTER (WHERE ${ratings.accountDays} < ${CLAIM_RULES.youngDays})::int`,
          excluded: sql<number>`count(*) FILTER (WHERE NOT ${COUNTED})::int`,
        })
        .from(ratings)
        .where(eq(ratings.claimId, open.id))
      const [top] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ratings)
        .where(and(eq(ratings.claimId, open.id), isNotNull(ratings.clientHash)))
        .groupBy(ratings.clientHash)
        .orderBy(sql`count(*) DESC`)
        .limit(1)
      return {
        claimId: open.id,
        survey,
        supportsConfirm: surveySupportsConfirm(survey),
        ratings: await readClaimRatings(tx, open.id),
        excluded: totals?.excluded ?? 0,
        anomaly: ratingAnomaly({
          total: totals?.total ?? 0,
          // Hashes clear after 30 days
          topPrefix: Math.max(top?.n ?? 0, open.maxPrefix ?? 0),
          young: totals?.young ?? 0,
        }),
      }
    },
    { role: "admin" },
  )
}
