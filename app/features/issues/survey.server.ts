import { and, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { fixSurveys } from "../../../db/schema/claims.ts"
import { issues, resolutionClaims } from "../../../db/schema/issues.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { type Keyring, linkKeyring } from "../../../server/signed-link.ts"
import {
  isSurveyAnswer,
  type SurveyAnswer,
  surveyDecision,
} from "../../../shared/claims.ts"
import type {
  AdvocacyStatus,
  GovernmentStatus,
} from "../../../shared/status.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { applyIssueAction } from "../moderation/referrals.server.ts"
import { readLink } from "../report/signed-link.server.ts"
import { surveyTally } from "./claims.server.ts"
import { type PurgeDeps, purgeIssuePages } from "./publish.server.ts"

// Raw code, label is frontend
const ANSWER_ACTION = "claim.survey_answer"

type Who = { userId: string; claimId: string | null }

/** Signed link first, then session. */
function identify(
  input: {
    tenant: TenantContext
    token: string | null
    session: SessionContext | null
  },
  keyring: () => Keyring,
): Who | null {
  const claim = readLink(input.token ?? "", "survei", input.tenant.id, keyring)
  if (claim) return { userId: claim.userId, claimId: claim.subjectId }
  return input.session ? { userId: input.session.user.id, claimId: null } : null
}

type OpenClaim = {
  issueId: string
  code: string
  title: string
  claimId: string | null
  gov: GovernmentStatus
  advocacy: AdvocacyStatus
  version: number
}

async function findOpen(tx: Tx, code: string): Promise<OpenClaim | null> {
  const [row] = await tx
    .select({
      issueId: issues.id,
      code: issues.publicCode,
      title: issues.title,
      claimId: resolutionClaims.id,
      gov: issues.govStatus,
      advocacy: issues.advocacyStatus,
      version: issues.version,
    })
    .from(issues)
    .leftJoin(
      resolutionClaims,
      and(
        eq(resolutionClaims.orgId, issues.orgId),
        eq(resolutionClaims.issueId, issues.id),
        isNull(resolutionClaims.closedAt),
      ),
    )
    .where(and(eq(issues.publicCode, code), isNotNull(issues.publishedAt)))
    .limit(1)
  return row ?? null
}

/** Open claim matching the link. */
function currentClaim(open: OpenClaim, who: Who): string | null {
  if (!open.claimId || open.gov !== "claimed_resolved") return null
  if (who.claimId && who.claimId !== open.claimId) return null
  return open.claimId
}

export type SurveyTarget =
  | { status: "open"; code: string; title: string; answer: SurveyAnswer | null }
  | { status: "closed" | "not_invited" | "sign_in_required" }

/** Survey page state, null 404. */
export function surveyTarget(input: {
  tenant: TenantContext
  code: string
  token: string | null
  session: SessionContext | null
  keyring?: () => Keyring
}): Promise<SurveyTarget | null> {
  const who = identify(input, input.keyring ?? linkKeyring)
  return withTenant(input.tenant.id, async (tx) => {
    const open = await findOpen(tx, input.code)
    if (!open) return null
    if (!who) return { status: "sign_in_required" }
    const claimId = currentClaim(open, who)
    if (!claimId) return { status: "closed" }
    const [survey] = await tx
      .select({ answer: fixSurveys.answer })
      .from(fixSurveys)
      .where(
        and(eq(fixSurveys.claimId, claimId), eq(fixSurveys.userId, who.userId)),
      )
    if (!survey) return { status: "not_invited" }
    return {
      status: "open",
      code: open.code,
      title: open.title,
      answer: survey.answer,
    }
  })
}

type AnswerFailure = "sign_in_required" | "not_invited" | "not_found" | "closed"

export type AnswerResult =
  | {
      status: 200
      body: { saved: SurveyAnswer; decided: "confirm" | "reopen" | null }
    }
  | { status: 400; body: { errors: ["answer"] } }
  | { status: 401 | 403 | 404 | 409; body: { error: AnswerFailure } }

export type SurveyDeps = PurgeDeps & { keyring?: () => Keyring }

function fail(status: 401 | 403 | 404 | 409, error: AnswerFailure) {
  return { status, body: { error } } as const
}

type Written =
  | { kind: "failed"; result: AnswerResult }
  | {
      kind: "saved"
      answer: SurveyAnswer
      decided: "confirm" | "reopen" | null
      purge: { code: string; version: number } | null
    }

/** Reporter answer, may decide. */
export async function answerSurvey(input: {
  tenant: TenantContext
  code: string
  token: string | null
  session: SessionContext | null
  form: FormData
  deps?: SurveyDeps
}): Promise<AnswerResult> {
  const deps = input.deps ?? {}
  const who = identify(input, deps.keyring ?? linkKeyring)
  if (!who) return fail(401, "sign_in_required")
  const raw = input.form.get("answer")
  const answer = typeof raw === "string" && isSurveyAnswer(raw) ? raw : null
  if (!answer) return { status: 400, body: { errors: ["answer"] } }
  const orgId = input.tenant.id
  const written = await withTenant(orgId, async (tx): Promise<Written> => {
    // Issue first, like applyIssueAction
    const [locked] = await tx
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(eq(issues.publicCode, input.code), isNotNull(issues.publishedAt)),
      )
      .for("update")
    if (!locked) return { kind: "failed", result: fail(404, "not_found") }
    // Read after the lock
    const open = await findOpen(tx, input.code)
    if (!open) return { kind: "failed", result: fail(404, "not_found") }
    const claimId = currentClaim(open, who)
    if (!claimId) return { kind: "failed", result: fail(409, "closed") }
    const saved = await tx
      .update(fixSurveys)
      .set({ answer, answeredAt: sql`now()` })
      .where(
        and(eq(fixSurveys.claimId, claimId), eq(fixSurveys.userId, who.userId)),
      )
      .returning({ userId: fixSurveys.userId })
    if (saved.length === 0) {
      return { kind: "failed", result: fail(403, "not_invited") }
    }
    await tx.insert(auditLog).values({
      orgId,
      actorId: who.userId,
      action: ANSWER_ACTION,
      entityType: "issue",
      entityId: open.issueId,
      changedColumns: ["answer"],
      reasonCode: answer,
    })
    const decision = surveyDecision(await surveyTally(tx, claimId))
    if (decision === "wait") {
      return { kind: "saved", answer, decided: null, purge: null }
    }
    const result = await applyIssueAction(tx, orgId, {
      issueId: open.issueId,
      seen: {
        advocacy: open.advocacy,
        government: "claimed_resolved",
        version: open.version,
      },
      actorId: null,
      basis: "survey",
      action: decision === "confirm" ? "confirm_resolved" : "reopen",
      note: null,
    })
    // Answer kept, admin decides
    if (!result.ok) return { kind: "saved", answer, decided: null, purge: null }
    return { kind: "saved", answer, decided: decision, purge: result }
  })
  if (written.kind === "failed") return written.result
  if (written.purge) {
    await purgeIssuePages(input.tenant.host, written.purge, deps)
  }
  return {
    status: 200,
    body: { saved: written.answer, decided: written.decided },
  }
}

// Answer and token only
const MAX_BODY_BYTES = 8 * 1024

/** Route action wiring, hidden t. */
export async function answerSurveyRequest(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
  code: string
}): Promise<AnswerResult | { status: 413 }> {
  const { request } = input
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: 413 }
  }
  const form = await request.formData()
  const token = form.get("t")
  return answerSurvey({
    tenant: input.tenant,
    code: input.code,
    token: typeof token === "string" && token !== "" ? token : null,
    session: input.session,
    form,
  })
}
