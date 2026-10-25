import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"
import { notifyComplainant } from "../../../db/notifications.server.ts"
import { auditLog, type ValueHashes } from "../../../db/schema/audit.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import {
  demandItems,
  demands,
  policyBriefs,
} from "../../../db/schema/demands.ts"
import { issueReports, issues } from "../../../db/schema/issues.ts"
import {
  contentComplaints,
  type RedactedColumn,
  redactionOriginals,
} from "../../../db/schema/moderation.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { hashKey, valueHash } from "../../../server/email-log.ts"
import type { PurgeDeps } from "../../../server/purge.server.ts"
import {
  COMPLAINT_LENGTHS,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  type ComplaintPart,
  type ComplaintReason,
  type ComplaintStatus,
  type ComplaintSubjectKind,
  decisionsFor,
  isDecisionReasonFor,
  type StandardReason,
  type TakedownReason,
} from "../../../shared/complaints.ts"
import type { PublicFile } from "../../../shared/evidence.ts"
import type { EvidenceKind } from "../../../shared/report-fields.ts"
import type { DemandState } from "../../../shared/status.ts"
import {
  citedIssues,
  type PurgedDemand,
  purgeDemandPages,
} from "../demands/purge.server.ts"
import type { ComplaintFilter } from "./fields.ts"
import { ISSUE_SUMMARY_LENGTH, ISSUE_TITLE_LENGTH } from "./fields.ts"
import {
  listTakedowns,
  queueTakedown,
  type TakedownView,
  withdrawEvidence,
} from "./takedown.server.ts"

const FILTER_STATUSES: Record<ComplaintFilter, ComplaintStatus[]> = {
  baru: ["open"],
  banding: ["appealed"],
  selesai: ["decided", "appeal_decided"],
}

export const COMPLAINT_LIST_LIMIT = 100

export type ComplaintRow = {
  code: string
  status: ComplaintStatus
  reason: ComplaintReason
  subject: { kind: ComplaintSubjectKind; code: string; title: string }
  createdAt: Date
}

const c = contentComplaints

/** Waiting oldest first, else newest. */
export function listComplaints(
  orgId: string,
  role: MemberRole,
  filter: ComplaintFilter | null,
): Promise<ComplaintRow[]> {
  const statuses = filter ? FILTER_STATUSES[filter] : null
  const waiting = filter === "baru" || filter === "banding"
  return withTenant(
    orgId,
    async (tx) => {
      const rows = await tx
        .select({
          code: c.publicCode,
          status: c.status,
          reason: c.reason,
          issueCode: issues.publicCode,
          issueTitle: issues.title,
          demandCode: demands.publicCode,
          demandTitle: demands.title,
          createdAt: c.createdAt,
        })
        .from(c)
        .leftJoin(
          issues,
          and(eq(issues.orgId, c.orgId), eq(issues.id, c.issueId)),
        )
        .leftJoin(
          demands,
          and(eq(demands.orgId, c.orgId), eq(demands.id, c.demandId)),
        )
        .where(statuses ? inArray(c.status, statuses) : undefined)
        .orderBy(waiting ? asc(c.createdAt) : desc(c.createdAt), desc(c.id))
        .limit(COMPLAINT_LIST_LIMIT)
      return rows.map(
        ({ issueCode, issueTitle, demandCode, demandTitle, ...row }) => ({
          ...row,
          subject: subjectOf({
            issueCode,
            issueTitle,
            demandCode,
            demandTitle,
          }),
        }),
      )
    },
    { role },
  )
}

/** One of issue or tuntutan. */
function subjectOf(row: {
  issueCode: string | null
  issueTitle: string | null
  demandCode: string | null
  demandTitle: string | null
}): ComplaintRow["subject"] {
  return row.demandCode
    ? { kind: "demand", code: row.demandCode, title: row.demandTitle ?? "" }
    : { kind: "issue", code: row.issueCode ?? "", title: row.issueTitle ?? "" }
}

/** Waiting counts for /kelola. */
export function countWaitingComplaints(
  orgId: string,
  role: MemberRole,
): Promise<{ open: number; appealed: number }> {
  return withTenant(
    orgId,
    async (tx) => {
      const rows = await tx
        .select({ status: c.status, n: sql<number>`count(*)::int` })
        .from(c)
        .where(inArray(c.status, ["open", "appealed"]))
        .groupBy(c.status)
      const n = (status: ComplaintStatus) =>
        rows.find((row) => row.status === status)?.n ?? 0
      return { open: n("open"), appealed: n("appealed") }
    },
    { role },
  )
}

type Decided = {
  decision: ComplaintDecision
  reason: ComplaintDecisionReason
  text: string
  by: string
  at: Date
}

export type ComplaintDetail = {
  id: string
  code: string
  status: ComplaintStatus
  reason: ComplaintReason
  part: ComplaintPart
  explanation: string
  createdAt: Date
  first: Decided | null
  appeal: { text: string; at: Date } | null
  appealDecision: Decided | null
  // Exactly one is set
  issue: {
    id: string
    code: string
    title: string
    summary: string
    version: number
    publishedAt: Date | null
    takenDownAt: Date | null
    redactedAt: Date | null
  } | null
  demand: {
    id: string
    code: string
    title: string
    summary: string
    version: number
    state: DemandState
    hiddenAt: Date | null
  } | null
  evidence: {
    id: string
    reportCode: string
    position: number
    kind: EvidenceKind
  }[]
  takedowns: TakedownView[]
}

function decided(
  decision: ComplaintDecision | null,
  reason: ComplaintDecisionReason | null,
  text: string | null,
  by: string | null,
  at: Date | null,
): Decided | null {
  return decision && reason && text && by && at
    ? { decision, reason, text, by, at }
    : null
}

/** Staff only, never the account. */
export function getComplaint(
  orgId: string,
  role: MemberRole,
  code: string,
): Promise<ComplaintDetail | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const [row] = await tx
        .select({
          complaint: {
            id: c.id,
            code: c.publicCode,
            status: c.status,
            reason: c.reason,
            part: c.part,
            explanation: c.explanation,
            createdAt: c.createdAt,
            decision: c.decision,
            decisionReason: c.decisionReason,
            decisionText: c.decisionText,
            decidedBy: c.decidedBy,
            decidedAt: c.decidedAt,
            appealText: c.appealText,
            appealedAt: c.appealedAt,
            appealDecision: c.appealDecision,
            appealReason: c.appealReason,
            appealDecisionText: c.appealDecisionText,
            appealDecidedBy: c.appealDecidedBy,
            appealDecidedAt: c.appealDecidedAt,
          },
          issue: {
            id: issues.id,
            code: issues.publicCode,
            title: issues.title,
            summary: issues.summary,
            version: issues.version,
            publishedAt: issues.publishedAt,
            takenDownAt: issues.takenDownAt,
            redactedAt: issues.redactedAt,
          },
          demand: {
            id: demands.id,
            code: demands.publicCode,
            title: demands.title,
            summary: demands.summary,
            version: demands.version,
            state: demands.state,
            hiddenAt: demands.hiddenAt,
          },
        })
        .from(c)
        .leftJoin(
          issues,
          and(eq(issues.orgId, c.orgId), eq(issues.id, c.issueId)),
        )
        .leftJoin(
          demands,
          and(eq(demands.orgId, c.orgId), eq(demands.id, c.demandId)),
        )
        .where(eq(c.publicCode, code))
        .limit(1)
      if (!row) return null
      const { complaint: k, issue, demand } = row
      const files = !issue
        ? []
        : await tx
            .select({
              id: evidence.id,
              reportCode: reports.publicCode,
              position: evidence.position,
              kind: evidence.kind,
            })
            .from(evidence)
            .innerJoin(
              reports,
              and(
                eq(reports.orgId, evidence.orgId),
                eq(reports.id, evidence.reportId),
              ),
            )
            .innerJoin(
              issueReports,
              and(
                eq(issueReports.orgId, evidence.orgId),
                eq(issueReports.reportId, evidence.reportId),
              ),
            )
            .where(
              and(
                eq(issueReports.issueId, issue.id),
                eq(evidence.status, "published"),
              ),
            )
            .orderBy(asc(reports.createdAt), asc(evidence.position))
      return {
        id: k.id,
        code: k.code,
        status: k.status,
        reason: k.reason,
        part: k.part,
        explanation: k.explanation,
        createdAt: k.createdAt,
        first: decided(
          k.decision,
          k.decisionReason,
          k.decisionText,
          k.decidedBy,
          k.decidedAt,
        ),
        appeal:
          k.appealText && k.appealedAt
            ? { text: k.appealText, at: k.appealedAt }
            : null,
        appealDecision: decided(
          k.appealDecision,
          k.appealReason,
          k.appealDecisionText,
          k.appealDecidedBy,
          k.appealDecidedAt,
        ),
        issue,
        demand,
        evidence: files,
        takedowns: await listTakedowns(tx, k.id),
      }
    },
    { role },
  )
}

type IssueEdit = {
  title: string
  summary: string
  // Evidence ids to withhold
  withdraw: string[]
}

export type DecideInput = {
  complaintId: string
  stage: "first" | "appeal"
  decision: ComplaintDecision
  reason: ComplaintDecisionReason
  statement: string
  actorId: string
  // Issue version the admin saw
  subjectVersion: number
  edit?: IssueEdit
  // Sample seed opts out
  notify?: boolean
}

export type DecideResult =
  | { ok: true }
  | {
      ok: false
      reason: "not_found" | "changed" | "not_allowed" | "same_admin"
    }

type Effect = { ok: true } | { ok: false; reason: "not_allowed" }

type LockedIssue = {
  id: string
  title: string
  summary: string
  version: number
  publishedAt: Date | null
  takenDownAt: Date | null
}

const within = (value: string, range: { min: number; max: number }) =>
  value.length >= range.min && value.length <= range.max

/** Pure checks before any write. */
function validInput(input: DecideInput): boolean {
  if (!isDecisionReasonFor(input.decision, input.reason)) return false
  if (!within(input.statement, COMPLAINT_LENGTHS.statement)) return false
  if (input.decision !== "edit") return true
  const edit = input.edit
  return Boolean(
    edit &&
      within(edit.title, ISSUE_TITLE_LENGTH) &&
      within(edit.summary, ISSUE_SUMMARY_LENGTH),
  )
}

async function audit(
  tx: Tx,
  orgId: string,
  row: {
    actorId: string
    action:
      | "complaint.decide"
      | "complaint.appeal_decide"
      | "issue.redact"
      | "issue.unpublish"
      | "issue.take_down"
      | "demand.hide"
    entityType: "complaint" | "issue" | "demand"
    entityId: string
    changedColumns?: string[]
    valueHashes?: ValueHashes
    reasonCode: string
  },
): Promise<string> {
  const [event] = await tx
    .insert(auditLog)
    .values({ orgId, ...row })
    .returning({ id: auditLog.id })
  if (!event) throw new Error("audit row not inserted")
  return event.id
}

async function redact(
  tx: Tx,
  orgId: string,
  issue: LockedIssue,
  input: DecideInput & { edit: IssueEdit },
): Promise<{ files: PublicFile[] } | null> {
  const next: Record<RedactedColumn, string> = {
    title: input.edit.title,
    summary: input.edit.summary,
  }
  const changed = (["title", "summary"] as const).filter(
    (column) => issue[column] !== next[column],
  )
  const files = await withdrawEvidence(tx, issue.id, {
    only: input.edit.withdraw,
    withholdBy: input.actorId,
  })
  if (changed.length === 0 && files.length === 0) return null
  const reason = input.reason as StandardReason
  if (changed.length > 0) {
    await tx.insert(redactionOriginals).values(
      changed.map((column) => ({
        orgId,
        issueId: issue.id,
        column,
        original: issue[column],
        reasonCode: reason,
        complaintId: input.complaintId,
        createdBy: input.actorId,
      })),
    )
  }
  await tx
    .update(issues)
    .set({
      title: next.title,
      summary: next.summary,
      redactedAt: sql`now()`,
      redactionReason: reason,
      version: sql`${issues.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(issues.id, issue.id))
  const key = hashKey()
  const hashes: ValueHashes = Object.fromEntries(
    changed.map((column) => [
      column,
      {
        old: valueHash(issue[column], key),
        new: valueHash(next[column], key),
      },
    ]),
  )
  await audit(tx, orgId, {
    actorId: input.actorId,
    action: "issue.redact",
    entityType: "issue",
    entityId: issue.id,
    changedColumns: [...changed, ...(files.length > 0 ? ["evidence"] : [])],
    valueHashes: hashes,
    reasonCode: reason,
  })
  return { files }
}

async function applyEffect(
  tx: Tx,
  orgId: string,
  issue: LockedIssue,
  input: DecideInput,
): Promise<Effect> {
  const { decision } = input
  if (decision === "keep") return { ok: true }
  if (issue.takenDownAt) return { ok: false, reason: "not_allowed" }
  if (decision === "edit") {
    if (!input.edit) return { ok: false, reason: "not_allowed" }
    const done = await redact(tx, orgId, issue, { ...input, edit: input.edit })
    if (!done) return { ok: false, reason: "not_allowed" }
    if (issue.publishedAt || done.files.length > 0) {
      await queueTakedown(tx, orgId, {
        action: "redact",
        issueId: issue.id,
        complaintId: input.complaintId,
        publicFiles: done.files,
        evidenceIds: [],
        actorId: input.actorId,
      })
    }
    return { ok: true }
  }
  return withdrawIssue(tx, orgId, issue, {
    remove: decision === "remove",
    reason: input.reason as StandardReason,
    complaintId: input.complaintId,
    actorId: input.actorId,
  })
}

/** Hide or take down. */
export async function withdrawIssue(
  tx: Tx,
  orgId: string,
  issue: Pick<LockedIssue, "id" | "publishedAt" | "takenDownAt">,
  input: {
    remove: boolean
    reason: TakedownReason
    complaintId: string | null
    actorId: string
  },
): Promise<Effect> {
  if (issue.takenDownAt) return { ok: false, reason: "not_allowed" }
  if (!input.remove && !issue.publishedAt) {
    return { ok: false, reason: "not_allowed" }
  }
  const { remove, reason } = input
  await tx
    .update(issues)
    .set({
      publishedAt: null,
      ...(remove ? { takenDownAt: sql`now()`, takedownReason: reason } : {}),
      version: sql`${issues.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(issues.id, issue.id))
  const files = await withdrawEvidence(tx, issue.id)
  await audit(tx, orgId, {
    actorId: input.actorId,
    action: remove ? "issue.take_down" : "issue.unpublish",
    entityType: "issue",
    entityId: issue.id,
    changedColumns: remove
      ? ["published_at", "taken_down_at", "version"]
      : ["published_at", "version"],
    reasonCode: reason,
  })
  await queueTakedown(tx, orgId, {
    action: remove ? "take_down" : "unpublish",
    issueId: issue.id,
    complaintId: input.complaintId,
    publicFiles: files,
    evidenceIds: [],
    actorId: input.actorId,
  })
  return { ok: true }
}

function stageColumns(input: DecideInput): PgUpdateSetSource<typeof c> {
  if (input.stage === "first") {
    return {
      status: "decided",
      decision: input.decision,
      decisionReason: input.reason,
      decisionText: input.statement,
      decidedBy: input.actorId,
      decidedAt: sql`now()`,
    }
  }
  return {
    status: "appeal_decided",
    appealDecision: input.decision,
    appealReason: input.reason,
    appealDecisionText: input.statement,
    appealDecidedBy: input.actorId,
    appealDecidedAt: sql`now()`,
  }
}

class Rollback extends Error {
  constructor(readonly reason: "not_allowed") {
    super(reason)
  }
}

type DecideDone = { ok: true; purge: PurgedDemand | null }

/** Keep or hide, admin text. */
async function demandEffect(
  tx: Tx,
  orgId: string,
  demandId: string,
  input: DecideInput,
): Promise<
  | { ok: true; purge: PurgedDemand | null }
  | { ok: false; reason: "not_found" | "changed" | "not_allowed" }
> {
  const [demand] = await tx
    .select({
      code: demands.publicCode,
      state: demands.state,
      version: demands.version,
    })
    .from(demands)
    .where(eq(demands.id, demandId))
    .for("update")
  if (!demand) return { ok: false, reason: "not_found" }
  if (demand.version !== input.subjectVersion) {
    return { ok: false, reason: "changed" }
  }
  if (!(decisionsFor("demand") as readonly string[]).includes(input.decision)) {
    return { ok: false, reason: "not_allowed" }
  }
  if (input.decision === "keep") return { ok: true, purge: null }
  if (demand.state === "draft") return { ok: false, reason: "not_allowed" }
  return {
    ok: true,
    purge: await hideDemand(
      tx,
      orgId,
      { id: demandId, code: demand.code },
      {
        reason: input.reason as StandardReason,
        actorId: input.actorId,
        complaintId: input.complaintId,
      },
    ),
  }
}

/** Draft again, audited, durable purge. */
export async function hideDemand(
  tx: Tx,
  orgId: string,
  demand: { id: string; code: string },
  input: {
    reason: TakedownReason
    actorId: string
    complaintId: string | null
  },
): Promise<PurgedDemand> {
  const [hidden] = await tx
    .update(demands)
    .set({
      state: "draft",
      closedAt: null,
      hiddenAt: sql`now()`,
      hiddenReason: input.reason,
      version: sql`${demands.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(demands.id, demand.id))
    .returning({ version: demands.version })
  if (!hidden) throw new Error("demand not hidden")
  await audit(tx, orgId, {
    actorId: input.actorId,
    action: "demand.hide",
    entityType: "demand",
    entityId: demand.id,
    changedColumns: ["state", "hidden_at", "version"],
    reasonCode: input.reason,
  })
  // CMP-18: retried, takedown_late alerts
  await queueTakedown(tx, orgId, {
    action: "unpublish",
    issueId: null,
    complaintId: input.complaintId,
    publicFiles: [],
    evidenceIds: [],
    actorId: input.actorId,
  })
  // Hidden PDFs leave the CDN
  const briefs = await tx
    .select({ id: policyBriefs.id })
    .from(policyBriefs)
    .innerJoin(demandItems, eq(demandItems.id, policyBriefs.itemId))
    .where(
      and(
        eq(demandItems.demandId, demand.id),
        isNotNull(policyBriefs.publishedAt),
      ),
    )
  return {
    code: demand.code,
    version: hidden.version,
    briefs: briefs.map((row) => row.id),
    issues: await citedIssues(tx, demand.id),
  }
}

async function decideIn(
  tx: Tx,
  orgId: string,
  input: DecideInput,
): Promise<Exclude<DecideResult, { ok: true }> | DecideDone> {
  const [row] = await tx
    .select({
      status: c.status,
      decidedBy: c.decidedBy,
      issueId: c.issueId,
      demandId: c.demandId,
    })
    .from(c)
    .where(eq(c.id, input.complaintId))
    .for("update")
  if (!row) return { ok: false, reason: "not_found" }
  const expected = input.stage === "first" ? "open" : "appealed"
  if (row.status !== expected) return { ok: false, reason: "changed" }
  if (input.stage === "appeal" && row.decidedBy === input.actorId) {
    return { ok: false, reason: "same_admin" }
  }
  let purge: PurgedDemand | null = null
  if (row.demandId) {
    const effect = await demandEffect(tx, orgId, row.demandId, input)
    if (!effect.ok) return effect
    purge = effect.purge
  } else {
    const [issue] = await tx
      .select({
        id: issues.id,
        title: issues.title,
        summary: issues.summary,
        version: issues.version,
        publishedAt: issues.publishedAt,
        takenDownAt: issues.takenDownAt,
      })
      .from(issues)
      .where(eq(issues.id, row.issueId ?? ""))
      .for("update")
    if (!issue) return { ok: false, reason: "not_found" }
    if (issue.version !== input.subjectVersion) {
      return { ok: false, reason: "changed" }
    }
    const effect = await applyEffect(tx, orgId, issue, input)
    // Undo partial writes
    if (!effect.ok) throw new Rollback(effect.reason)
  }
  const [updated] = await tx
    .update(c)
    .set({ ...stageColumns(input), updatedAt: sql`now()` })
    .where(and(eq(c.id, input.complaintId), eq(c.status, expected)))
    .returning({ id: c.id })
  if (!updated) throw new Error("complaint changed under lock")
  const eventId = await audit(tx, orgId, {
    actorId: input.actorId,
    action:
      input.stage === "first" ? "complaint.decide" : "complaint.appeal_decide",
    entityType: "complaint",
    entityId: input.complaintId,
    changedColumns: ["status"],
    reasonCode: input.reason,
  })
  if (input.notify !== false) {
    await notifyComplainant(tx, {
      orgId,
      complaintId: input.complaintId,
      eventId,
      template:
        input.stage === "first"
          ? "complaint_decided"
          : "complaint_appeal_decided",
    })
  }
  return { ok: true, purge }
}

/** Reasoned decision, PLAN §5.10. */
export async function decideComplaint(
  tenant: { id: string; host: string },
  input: DecideInput,
  deps: PurgeDeps = {},
): Promise<DecideResult> {
  if (!validInput(input)) return { ok: false, reason: "not_allowed" }
  try {
    const result = await withTenant(
      tenant.id,
      (tx) => decideIn(tx, tenant.id, input),
      { role: "admin" },
    )
    if (!result.ok) return result
    // Hidden tuntutan leaves the CDN
    if (result.purge) await purgeDemandPages(tenant.host, result.purge, deps)
    return { ok: true }
  } catch (error) {
    if (error instanceof Rollback) return { ok: false, reason: error.reason }
    throw error
  }
}
