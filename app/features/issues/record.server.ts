import { asc, desc, eq } from "drizzle-orm"
import { issueEvents, referrals, responses } from "../../../db/schema/issues.ts"
import type { Tx } from "../../../db/tenant.server.ts"
import type {
  EscalationChannel,
  IssueEventAction,
  ReferralChannel,
  ReferralKind,
} from "../../../shared/moderation.ts"
import type {
  AdvocacyStatus,
  GovernmentStatus,
} from "../../../shared/status.ts"

export type IssueReferral = {
  id: string
  kind: ReferralKind
  agency: string
  channel: ReferralChannel | EscalationChannel
  ticket: string | null
  sentOn: string
  deadlineOn: string | null
}

export type IssueResponse = {
  id: string
  agency: string
  body: string
  respondedOn: string
  sourceUrl: string
}

export type IssueEvent = {
  id: string
  action: IssueEventAction
  advocacyStatus: AdvocacyStatus
  govStatus: GovernmentStatus
  referralId: string | null
  responseId: string | null
  note: string | null
  occurredAt: Date
}

export type IssueRecord = {
  referrals: IssueReferral[]
  responses: IssueResponse[]
  events: IssueEvent[]
}

/** Public columns, events oldest first. */
export async function readIssueRecord(
  tx: Tx,
  issueId: string,
): Promise<IssueRecord> {
  const referralRows = await tx
    .select({
      id: referrals.id,
      kind: referrals.kind,
      agency: referrals.agency,
      channel: referrals.channel,
      ticket: referrals.ticket,
      sentOn: referrals.sentOn,
      deadlineOn: referrals.deadlineOn,
    })
    .from(referrals)
    .where(eq(referrals.issueId, issueId))
    .orderBy(desc(referrals.sentOn), desc(referrals.createdAt))
  const responseRows = await tx
    .select({
      id: responses.id,
      agency: responses.agency,
      body: responses.body,
      respondedOn: responses.respondedOn,
      sourceUrl: responses.sourceUrl,
    })
    .from(responses)
    .where(eq(responses.issueId, issueId))
    .orderBy(desc(responses.respondedOn), desc(responses.createdAt))
  const eventRows = await tx
    .select({
      id: issueEvents.id,
      action: issueEvents.action,
      advocacyStatus: issueEvents.advocacyStatus,
      govStatus: issueEvents.govStatus,
      referralId: issueEvents.referralId,
      responseId: issueEvents.responseId,
      note: issueEvents.note,
      occurredAt: issueEvents.occurredAt,
    })
    .from(issueEvents)
    .where(eq(issueEvents.issueId, issueId))
    .orderBy(asc(issueEvents.occurredAt), asc(issueEvents.id))
  return { referrals: referralRows, responses: responseRows, events: eventRows }
}

/** Latest of one kind. */
export function latestReferral(
  record: IssueRecord,
  kind: ReferralKind,
): IssueReferral | null {
  return record.referrals.find((r) => r.kind === kind) ?? null
}
