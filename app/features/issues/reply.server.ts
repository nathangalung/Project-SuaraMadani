import { and, count, eq, gt, isNotNull, sql } from "drizzle-orm"
import { sendJob } from "../../../db/jobs.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { members } from "../../../db/schema/auth.ts"
import { issues } from "../../../db/schema/issues.ts"
import { notifications } from "../../../db/schema/notifications.ts"
import { agencyReplies } from "../../../db/schema/replies.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import {
  checkReply,
  DAILY_REPLIES,
  type ReplyErrorKey,
  type ReplyInput,
} from "../../../shared/replies.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { longText, text, UUID } from "../moderation/form-values.ts"

type ReplyFailure =
  | "sign_in_required"
  | "email_unverified"
  | "captcha_failed"
  | "not_found"
  | "quota_exceeded"

export type SubmitReplyResult =
  | { status: 200 | 201; body: { code: string } }
  | { status: 400; body: { errors: ReplyErrorKey[] } }
  | { status: 401 | 403 | 404 | 429; body: { error: ReplyFailure } }

export type ReplyDeps = {
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
}

function fail(status: 401 | 403 | 404 | 429, error: ReplyFailure) {
  return { status, body: { error } } as const
}

async function publishedIssue(
  tx: Tx,
  code: string,
): Promise<{ id: string; code: string; title: string } | null> {
  const [row] = await tx
    .select({ id: issues.id, code: issues.publicCode, title: issues.title })
    .from(issues)
    .where(and(eq(issues.publicCode, code), isNotNull(issues.publishedAt)))
    .limit(1)
  return row ?? null
}

/** Published issue here, or null. */
export function replyTarget(
  orgId: string,
  code: string,
): Promise<{ code: string; title: string } | null> {
  return withTenant(orgId, async (tx) => {
    const issue = await publishedIssue(tx, code)
    return issue ? { code: issue.code, title: issue.title } : null
  })
}

type Inserted = "created" | "existing" | "quota" | "not_found"

async function insertReply(
  tx: Tx,
  input: {
    orgId: string
    userId: string
    code: string
    submissionId: string
    reply: ReplyInput
  },
): Promise<Inserted> {
  const { orgId, userId } = input
  // Serialises one sender's submits
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 3))`,
  )
  const [existing] = await tx
    .select({ id: agencyReplies.id })
    .from(agencyReplies)
    .where(
      and(
        eq(agencyReplies.userId, userId),
        eq(agencyReplies.submissionId, input.submissionId),
      ),
    )
  if (existing) return "existing"
  const issue = await publishedIssue(tx, input.code)
  if (!issue) return "not_found"
  const [recent] = await tx
    .select({ n: count() })
    .from(agencyReplies)
    .where(
      and(
        eq(agencyReplies.userId, userId),
        gt(agencyReplies.createdAt, sql`now() - interval '24 hours'`),
      ),
    )
  if ((recent?.n ?? 0) >= DAILY_REPLIES) return "quota"
  const [row] = await tx
    .insert(agencyReplies)
    .values({
      orgId,
      issueId: issue.id,
      userId,
      submissionId: input.submissionId,
      ...input.reply,
    })
    .returning({ id: agencyReplies.id })
  if (!row) throw new Error("reply not inserted")
  // Email needs a membership
  await tx
    .insert(members)
    .values({ organizationId: orgId, userId, role: "reporter" })
    .onConflictDoNothing({ target: [members.organizationId, members.userId] })
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId,
      actorId: userId,
      action: "reply.submit",
      entityType: "issue",
      entityId: issue.id,
    })
    .returning({ id: auditLog.id })
  if (!event) throw new Error("audit row not inserted")
  await notifySender(tx, {
    orgId,
    userId,
    eventId: event.id,
    replyId: row.id,
    template: "reply_received",
  })
  return "created"
}

/** One row, one email-send job. */
export async function notifySender(
  tx: Tx,
  event: {
    orgId: string
    userId: string | null
    eventId: string
    replyId: string
    template: "reply_received" | "reply_decided"
  },
): Promise<void> {
  // Deleted account, nobody to tell
  if (!event.userId) return
  const [row] = await tx
    .insert(notifications)
    .values({
      orgId: event.orgId,
      userId: event.userId,
      eventId: event.eventId,
      template: event.template,
      replyId: event.replyId,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  if (row) {
    await sendJob(tx, "email-send", {
      orgId: event.orgId,
      notificationId: row.id,
    })
  }
}

/** Account, Turnstile, daily cap. */
export async function submitReply(input: {
  tenant: TenantContext
  session: SessionContext | null
  code: string
  form: FormData
  remoteIp: string | null
  deps: ReplyDeps
}): Promise<SubmitReplyResult> {
  const { form } = input
  if (!input.session) return fail(401, "sign_in_required")
  // Admins check the agency address
  if (!input.session.user.emailVerified) return fail(403, "email_unverified")
  const submissionId = text(form, "submissionId")
  if (!UUID.test(submissionId)) return { status: 400, body: { errors: [] } }
  const checked = checkReply({
    agency: text(form, "agency"),
    senderRole: text(form, "senderRole"),
    body: longText(form, "body"),
    sourceUrl: text(form, "sourceUrl"),
  })
  if (!checked.ok) return { status: 400, body: { errors: checked.errors } }
  const captcha = await input.deps.verifyCaptcha(
    text(form, "turnstileToken") || null,
    input.remoteIp,
    submissionId,
  )
  const userId = input.session.user.id
  // Duplicate token: maybe our retry
  if (!captcha.ok && captcha.reason !== "duplicate") {
    return fail(403, "captcha_failed")
  }
  const inserted = await withTenant(
    input.tenant.id,
    async (tx): Promise<Inserted> => {
      if (captcha.ok) {
        return insertReply(tx, {
          orgId: input.tenant.id,
          userId,
          code: input.code,
          submissionId,
          reply: checked.input,
        })
      }
      const [existing] = await tx
        .select({ id: agencyReplies.id })
        .from(agencyReplies)
        .where(
          and(
            eq(agencyReplies.userId, userId),
            eq(agencyReplies.submissionId, submissionId),
          ),
        )
      return existing ? "existing" : "not_found"
    },
    { role: "reporter" },
  )
  if (!captcha.ok && inserted !== "existing") return fail(403, "captcha_failed")
  if (inserted === "not_found") return fail(404, "not_found")
  if (inserted === "quota") return fail(429, "quota_exceeded")
  return {
    status: inserted === "created" ? 201 : 200,
    body: { code: input.code },
  }
}

// Body text fits 10,000 chars
const MAX_BODY_BYTES = 64 * 1024

/** Route action wiring, real Turnstile. */
export async function replyRequest(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
  code: string
}): Promise<SubmitReplyResult | { status: 413 }> {
  const { request } = input
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: 413 }
  }
  return submitReply({
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
    },
  })
}
