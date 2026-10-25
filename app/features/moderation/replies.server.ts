import { and, asc, desc, eq, sql } from "drizzle-orm"
import { auditLog } from "../../../db/schema/audit.ts"
import { users } from "../../../db/schema/auth.ts"
import { issues, responses } from "../../../db/schema/issues.ts"
import { agencyReplies } from "../../../db/schema/replies.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { originFor } from "../../../server/origin.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { parseSourceUrl } from "../../../shared/moderation.ts"
import {
  isReplyRejectReason,
  type ReplyRejectReason,
  type ReplyStatus,
} from "../../../shared/replies.ts"
import { type PurgeDeps, purgeIssuePages } from "../issues/publish.server.ts"
import { notifySender } from "../issues/reply.server.ts"
import type { Admin } from "./access.server.ts"
import { applyIssueAction } from "./referrals.server.ts"

// Queue page, newest decisions
const LIST_LIMIT = 100

export type ManagedReply = {
  id: string
  issueCode: string
  issueTitle: string
  agency: string
  senderRole: string
  body: string
  sourceUrl: string | null
  // Staff only, to verify sender
  senderEmail: string | null
  status: ReplyStatus
  rejectReason: ReplyRejectReason | null
  createdAt: Date
  decidedAt: Date | null
}

/** Pending oldest first, else newest. */
export function listReplies(
  orgId: string,
  status: ReplyStatus = "pending",
): Promise<ManagedReply[]> {
  return withTenant(
    orgId,
    (tx) =>
      tx
        .select({
          id: agencyReplies.id,
          issueCode: issues.publicCode,
          issueTitle: issues.title,
          agency: agencyReplies.agency,
          senderRole: agencyReplies.senderRole,
          body: agencyReplies.body,
          sourceUrl: agencyReplies.sourceUrl,
          // Unproven address is no identity
          senderEmail: sql<
            string | null
          >`CASE WHEN ${users.emailVerified} THEN ${users.email} END`,
          status: agencyReplies.status,
          rejectReason: agencyReplies.rejectReason,
          createdAt: agencyReplies.createdAt,
          decidedAt: agencyReplies.decidedAt,
        })
        .from(agencyReplies)
        .innerJoin(
          issues,
          and(
            eq(issues.orgId, agencyReplies.orgId),
            eq(issues.id, agencyReplies.issueId),
          ),
        )
        .leftJoin(users, eq(users.id, agencyReplies.userId))
        .where(eq(agencyReplies.status, status))
        .orderBy(
          status === "pending"
            ? asc(agencyReplies.createdAt)
            : desc(agencyReplies.decidedAt),
          asc(agencyReplies.id),
        )
        .limit(LIST_LIMIT),
    { role: "admin" },
  )
}

export type ReplyDecision =
  | { accept: true; sourceUrl?: string | null }
  | { reject: ReplyRejectReason }

/** Admin form, null if malformed. */
export function parseReplyDecision(form: FormData): ReplyDecision | null {
  const field = (key: string) => {
    const value = form.get(key)
    return typeof value === "string" ? value.trim() : ""
  }
  const intent = field("intent")
  if (intent === "reject") {
    const reason = field("reason")
    return isReplyRejectReason(reason) ? { reject: reason } : null
  }
  if (intent !== "accept") return null
  const raw = field("sourceUrl")
  if (!raw) return { accept: true }
  const sourceUrl = parseSourceUrl(raw)
  return sourceUrl ? { accept: true, sourceUrl } : null
}

export type DecideReplyResult =
  | { ok: true; code: string; version: number | null }
  | { ok: false; reason: "changed" | "not_allowed" }

type Decided = DecideReplyResult & { purge?: boolean }

async function decide(
  tx: Tx,
  input: {
    orgId: string
    origin: string
    replyId: string
    actorId: string
    decision: ReplyDecision
  },
): Promise<Decided> {
  const { orgId } = input
  const [reply] = await tx
    .select({
      issueId: agencyReplies.issueId,
      userId: agencyReplies.userId,
      agency: agencyReplies.agency,
      body: agencyReplies.body,
      sourceUrl: agencyReplies.sourceUrl,
      createdAt: agencyReplies.createdAt,
      code: issues.publicCode,
      advocacy: issues.advocacyStatus,
      government: issues.govStatus,
      version: issues.version,
    })
    .from(agencyReplies)
    .innerJoin(
      issues,
      and(
        eq(issues.orgId, agencyReplies.orgId),
        eq(issues.id, agencyReplies.issueId),
      ),
    )
    .where(
      and(
        eq(agencyReplies.id, input.replyId),
        eq(agencyReplies.status, "pending"),
      ),
    )
    .for("update", { of: agencyReplies })
  if (!reply) return { ok: false, reason: "changed" }
  const decided = {
    decidedBy: input.actorId,
    decidedAt: sql`now()`,
  }
  let version: number | null = null
  if ("accept" in input.decision) {
    const applied = await applyIssueAction(tx, orgId, {
      issueId: reply.issueId,
      seen: {
        advocacy: reply.advocacy,
        government: reply.government,
        version: reply.version,
      },
      actorId: input.actorId,
      action: "record_response",
      response: {
        agency: reply.agency,
        body: reply.body,
        respondedOn: jakartaIsoDate(reply.createdAt),
        sourceUrl:
          input.decision.sourceUrl ??
          reply.sourceUrl ??
          `${input.origin}/isu/${reply.code}#tanggapan`,
      },
    })
    if (!applied.ok) return applied
    version = applied.version
    // Written by this transaction
    const [response] = await tx
      .select({ id: responses.id })
      .from(responses)
      .where(
        and(
          eq(responses.issueId, reply.issueId),
          eq(responses.createdAt, sql`now()`),
        ),
      )
      .orderBy(desc(responses.id))
      .limit(1)
    if (!response) throw new Error("response not found")
    await tx
      .update(agencyReplies)
      .set({ ...decided, status: "accepted", responseId: response.id })
      .where(eq(agencyReplies.id, input.replyId))
  } else {
    await tx
      .update(agencyReplies)
      .set({
        ...decided,
        status: "rejected",
        rejectReason: input.decision.reject,
      })
      .where(eq(agencyReplies.id, input.replyId))
  }
  const accepted = "accept" in input.decision
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId,
      actorId: input.actorId,
      action: accepted ? "reply.accept" : "reply.reject",
      entityType: "issue",
      entityId: reply.issueId,
      changedColumns: ["status"],
      reasonCode: "reject" in input.decision ? input.decision.reject : null,
    })
    .returning({ id: auditLog.id })
  if (!event) throw new Error("audit row not inserted")
  await notifySender(tx, {
    orgId,
    userId: reply.userId,
    eventId: event.id,
    replyId: input.replyId,
    template: "reply_decided",
  })
  return { ok: true, code: reply.code, version, purge: accepted }
}

/** Accept records a response. */
export async function decideReply(
  tenant: { id: string; host: string },
  input: { replyId: string; actorId: string; decision: ReplyDecision },
  deps: PurgeDeps & { origin?: string } = {},
): Promise<DecideReplyResult> {
  const origin = deps.origin ?? originFor(tenant.host)
  const result = await withTenant(
    tenant.id,
    (tx) => decide(tx, { ...input, orgId: tenant.id, origin }),
    { role: "admin" },
  )
  if (!result.ok) return result
  if (result.purge && result.version !== null) {
    await purgeIssuePages(
      tenant.host,
      { code: result.code, version: result.version },
      deps,
    )
  }
  return { ok: true, code: result.code, version: result.version }
}

const REPLY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// Decision fields only
const MAX_DECISION_BYTES = 8 * 1024

export type DecideReplyRequestResult =
  | DecideReplyResult
  | { ok: false; reason: "invalid" | "too_large" }

/** Route action, after requireAdmin. */
export async function decideReplyRequest(input: {
  request: Request
  admin: Pick<Admin, "tenant" | "session">
}): Promise<DecideReplyRequestResult> {
  const { request, admin } = input
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > MAX_DECISION_BYTES) return { ok: false, reason: "too_large" }
  const form = await request.formData()
  const replyId = form.get("replyId")
  const decision = parseReplyDecision(form)
  if (typeof replyId !== "string" || !REPLY_ID.test(replyId) || !decision) {
    return { ok: false, reason: "invalid" }
  }
  return decideReply(admin.tenant, {
    replyId,
    actorId: admin.session.user.id,
    decision,
  })
}
