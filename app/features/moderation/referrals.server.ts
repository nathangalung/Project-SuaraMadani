import { and, eq, isNotNull, sql } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import {
  issueEvents,
  issues,
  referrals,
  responses,
} from "../../../db/schema/issues.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import type {
  EscalationChannel,
  ReferralChannel,
} from "../../../shared/moderation.ts"
import {
  canTransitionIssue,
  type IssueAction,
  type IssueState,
  transitionIssue,
} from "../../../shared/status.ts"
import { type PurgeDeps, purgeIssuePages } from "../issues/publish.server.ts"

type NoteAction = Exclude<IssueAction, "refer" | "escalate" | "record_response">

type ReferralInput = {
  agency: string
  ticket: string | null
  sentOn: string
}

export type IssueActionInput = {
  issueId: string
  // State the admin saw
  seen: IssueState & { version: number }
  actorId: string
  // Sample seed opts out
  notify?: boolean
} & (
  | {
      action: "refer"
      referral: ReferralInput & {
        channel: ReferralChannel
        deadlineOn: string
      }
    }
  | {
      action: "escalate"
      referral: ReferralInput & {
        channel: EscalationChannel
        deadlineOn: string | null
      }
    }
  | {
      action: "record_response"
      response: {
        agency: string
        body: string
        respondedOn: string
        sourceUrl: string
      }
    }
  | { action: NoteAction; note: string | null }
)

export type IssueActionResult =
  | { ok: true; code: string; version: number }
  | { ok: false; reason: "changed" | "not_allowed" }

type Linked = {
  referralId: string | null
  responseId: string | null
  note: string | null
  reasonCode: string | null
}

async function insertDetail(
  tx: Tx,
  orgId: string,
  input: IssueActionInput,
): Promise<Linked> {
  const none = { referralId: null, responseId: null, note: null }
  if (input.action === "refer" || input.action === "escalate") {
    const [row] = await tx
      .insert(referrals)
      .values({
        orgId,
        issueId: input.issueId,
        kind: input.action === "refer" ? "referral" : "escalation",
        ...input.referral,
        createdBy: input.actorId,
      })
      .returning({ id: referrals.id })
    if (!row) throw new Error("referral not inserted")
    return { ...none, referralId: row.id, reasonCode: input.referral.channel }
  }
  if (input.action === "record_response") {
    const [row] = await tx
      .insert(responses)
      .values({
        orgId,
        issueId: input.issueId,
        ...input.response,
        createdBy: input.actorId,
      })
      .returning({ id: responses.id })
    if (!row) throw new Error("response not inserted")
    return { ...none, responseId: row.id, reasonCode: null }
  }
  return { ...none, note: input.note, reasonCode: null }
}

/** CAS on axes, version. */
export async function applyIssueAction(
  tx: Tx,
  orgId: string,
  input: IssueActionInput,
): Promise<IssueActionResult> {
  const { seen } = input
  if (!canTransitionIssue(seen, input.action)) {
    return { ok: false, reason: "not_allowed" }
  }
  const { next } = transitionIssue(seen, input.action)
  const [row] = await tx
    .update(issues)
    .set({
      advocacyStatus: next.advocacy,
      govStatus: next.government,
      version: sql`${issues.version} + 1`,
      lastActivityAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(issues.id, input.issueId),
        eq(issues.orgId, orgId),
        isNotNull(issues.publishedAt),
        eq(issues.advocacyStatus, seen.advocacy),
        eq(issues.govStatus, seen.government),
        eq(issues.version, seen.version),
      ),
    )
    .returning({ code: issues.publicCode, version: issues.version })
  if (!row) return { ok: false, reason: "changed" }
  const linked = await insertDetail(tx, orgId, input)
  await tx.insert(issueEvents).values({
    orgId,
    issueId: input.issueId,
    action: input.action,
    advocacyStatus: next.advocacy,
    govStatus: next.government,
    referralId: linked.referralId,
    responseId: linked.responseId,
    note: linked.note,
  })
  await tx.insert(auditLog).values({
    orgId,
    actorId: input.actorId,
    action: `issue.${input.action}`,
    entityType: "issue",
    entityId: input.issueId,
    changedColumns: ["advocacy_status", "gov_status", "version"],
    reasonCode: linked.reasonCode,
  })
  return { ok: true, code: row.code, version: row.version }
}

/** Purges after commit, published only. */
export async function runIssueAction(
  tenant: { id: string; host: string },
  input: IssueActionInput,
  deps: PurgeDeps = {},
): Promise<IssueActionResult> {
  const result = await withTenant(
    tenant.id,
    (tx) => applyIssueAction(tx, tenant.id, input),
    { role: "admin" },
  )
  if (result.ok) await purgeIssuePages(tenant.host, result, deps)
  return result
}
