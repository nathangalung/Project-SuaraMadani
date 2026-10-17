import { and, count, eq, gt, isNotNull, ne, sql } from "drizzle-orm"
import { notifyComplainant } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { members } from "../../../db/schema/auth.ts"
import { demands } from "../../../db/schema/demands.ts"
import { issues } from "../../../db/schema/issues.ts"
import { contentComplaints } from "../../../db/schema/moderation.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import {
  appealDeadline,
  appealOpen,
  COMPLAINT_LENGTHS,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  type ComplaintPart,
  type ComplaintReason,
  type ComplaintStatus,
  type ComplaintSubjectKind,
  DAILY_COMPLAINTS,
  generateComplaintCode,
  partsFor,
} from "../../../shared/complaints.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { type ComplaintErrorKey, checkComplaint } from "./complaint-form.ts"

export type ComplaintDeps = {
  now: () => Date
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
}

type ComplaintFailure =
  | "sign_in_required"
  | "captcha_failed"
  | "not_found"
  | "quota_exceeded"

export type SubmitComplaintResult =
  | { status: 200 | 201; body: { code: string } }
  | { status: 400; body: { errors: ComplaintErrorKey[] } }
  | { status: 401 | 403 | 404 | 429; body: { error: ComplaintFailure } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function field(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === "string" ? value : ""
}

function fail(status: 401 | 403 | 404 | 429, error: ComplaintFailure) {
  return { status, body: { error } } as const
}

async function findSubmission(
  tx: Tx,
  userId: string,
  submissionId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ code: contentComplaints.publicCode })
    .from(contentComplaints)
    .where(
      and(
        eq(contentComplaints.userId, userId),
        eq(contentComplaints.submissionId, submissionId),
      ),
    )
    .limit(1)
  return row?.code ?? null
}

export type ComplaintSubject = { kind: ComplaintSubjectKind; code: string }

/** Public id, title, or null. */
async function findSubject(
  tx: Tx,
  subject: ComplaintSubject,
): Promise<{ id: string; code: string; title: string } | null> {
  const [row] =
    subject.kind === "issue"
      ? await tx
          .select({
            id: issues.id,
            code: issues.publicCode,
            title: issues.title,
          })
          .from(issues)
          .where(
            and(
              eq(issues.publicCode, subject.code),
              isNotNull(issues.publishedAt),
            ),
          )
          .limit(1)
      : await tx
          .select({
            id: demands.id,
            code: demands.publicCode,
            title: demands.title,
          })
          .from(demands)
          .where(
            and(
              eq(demands.publicCode, subject.code),
              ne(demands.state, "draft"),
            ),
          )
          .limit(1)
  return row ?? null
}

/** Public issue or tuntutan here. */
export function complaintTarget(
  orgId: string,
  subject: ComplaintSubject,
): Promise<{ code: string; title: string } | null> {
  return withTenant(orgId, async (tx) => {
    const found = await findSubject(tx, subject)
    return found ? { code: found.code, title: found.title } : null
  })
}

type Inserted =
  | { kind: "created"; code: string }
  | { kind: "existing"; code: string }
  | { kind: "quota" }
  | { kind: "not_found" }

async function insertComplaint(
  tx: Tx,
  input: {
    tenant: TenantContext
    userId: string
    subject: ComplaintSubject
    submissionId: string
    reason: ComplaintReason
    part: ComplaintPart
    explanation: string
    now: Date
    notify: boolean
  },
): Promise<Inserted> {
  const { tenant, userId } = input
  // Serialises one user's submits
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 1))`,
  )
  const existing = await findSubmission(tx, userId, input.submissionId)
  if (existing) return { kind: "existing", code: existing }
  const target = await findSubject(tx, input.subject)
  if (!target) return { kind: "not_found" }
  const [recent] = await tx
    .select({ n: count() })
    .from(contentComplaints)
    .where(
      and(
        eq(contentComplaints.userId, userId),
        gt(contentComplaints.createdAt, sql`now() - interval '24 hours'`),
      ),
    )
  if ((recent?.n ?? 0) >= DAILY_COMPLAINTS) return { kind: "quota" }
  const [row] = await tx
    .insert(contentComplaints)
    .values({
      orgId: tenant.id,
      ...(input.subject.kind === "issue"
        ? { issueId: target.id }
        : { demandId: target.id }),
      // New code on every retry
      publicCode: generateComplaintCode(tenant.campusCode, input.now),
      userId,
      submissionId: input.submissionId,
      reason: input.reason,
      part: input.part,
      explanation: input.explanation,
    })
    .returning({ id: contentComplaints.id, code: contentComplaints.publicCode })
  if (!row) throw new Error("complaint not inserted")
  // Email needs a membership
  await tx
    .insert(members)
    .values({ organizationId: tenant.id, userId, role: "reporter" })
    .onConflictDoNothing({ target: [members.organizationId, members.userId] })
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId: tenant.id,
      actorId: userId,
      action: "complaint.submit",
      entityType: "complaint",
      entityId: row.id,
      reasonCode: input.reason,
    })
    .returning({ id: auditLog.id })
  if (!event) throw new Error("audit row not inserted")
  if (input.notify) {
    await notifyComplainant(tx, {
      orgId: tenant.id,
      complaintId: row.id,
      eventId: event.id,
      template: "complaint_received",
    })
  }
  return { kind: "created", code: row.code }
}

function lookup(orgId: string, userId: string, submissionId: string) {
  return withTenant(orgId, (tx) => findSubmission(tx, userId, submissionId), {
    role: "reporter",
  })
}

/** PLAN §5.10 notice, flow 7. */
export async function submitComplaint(input: {
  tenant: TenantContext
  session: SessionContext | null
  subject: ComplaintSubject
  form: FormData
  remoteIp: string | null
  deps: ComplaintDeps
  // Sample seed opts out
  notify?: boolean
}): Promise<SubmitComplaintResult> {
  const { tenant, session, form, deps } = input
  if (!session) return fail(401, "sign_in_required")
  const userId = session.user.id
  const submissionId = field(form, "submissionId")
  if (!UUID.test(submissionId)) {
    return { status: 400, body: { errors: [] } }
  }
  const existing = await lookup(tenant.id, userId, submissionId)
  if (existing) return { status: 200, body: { code: existing } }

  const checked = checkComplaint(
    {
      reason: field(form, "reason"),
      part: field(form, "part"),
      explanation: field(form, "explanation"),
      goodFaith: field(form, "goodFaith") === "yes",
    },
    partsFor(input.subject.kind),
  )
  if ("errors" in checked) {
    return { status: 400, body: { errors: checked.errors } }
  }
  const captcha = await deps.verifyCaptcha(
    field(form, "turnstileToken") || null,
    input.remoteIp,
    submissionId,
  )
  if (!captcha.ok) {
    // Loser of a double submit
    if (captcha.reason === "duplicate") {
      const found = await lookup(tenant.id, userId, submissionId)
      if (found) return { status: 200, body: { code: found } }
    }
    return fail(403, "captcha_failed")
  }
  const inserted = await withTenant(
    tenant.id,
    (tx) =>
      insertComplaint(tx, {
        tenant,
        userId,
        subject: input.subject,
        submissionId,
        ...checked.input,
        now: deps.now(),
        notify: input.notify !== false,
      }),
    { role: "reporter" },
  )
  if (inserted.kind === "quota") return fail(429, "quota_exceeded")
  if (inserted.kind === "not_found") return fail(404, "not_found")
  return {
    status: inserted.kind === "created" ? 201 : 200,
    body: { code: inserted.code },
  }
}

// Form fields only
const MAX_BODY_BYTES = 16 * 1024

/** Route action wiring, real Turnstile. */
export async function complaintRequest(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
  subject: ComplaintSubject
}): Promise<SubmitComplaintResult | { status: 413 }> {
  const { request } = input
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return { status: 413 }
  }
  return submitComplaint({
    tenant: input.tenant,
    session: input.session,
    subject: input.subject,
    form: await request.formData(),
    remoteIp: request.headers.get("x-client-ip"),
    deps: {
      now: () => new Date(),
      verifyCaptcha: (token, ip, idempotencyKey) =>
        verifyTurnstile(token, {
          secret: turnstileSecret(),
          remoteIp: ip,
          idempotencyKey,
        }),
    },
  })
}

type Decided = {
  decision: ComplaintDecision
  reason: ComplaintDecisionReason
  text: string
  decidedAt: Date
}

export type OwnComplaint = {
  code: string
  status: ComplaintStatus
  reason: ComplaintReason
  part: ComplaintPart
  explanation: string
  createdAt: Date
  // Issue or tuntutan, public link
  subject: {
    kind: ComplaintSubjectKind
    code: string
    title: string
    published: boolean
  }
  decision: Decided | null
  appeal: { text: string; appealedAt: Date } | null
  appealDecision: Decided | null
  canAppeal: boolean
  appealUntil: Date | null
}

function decided(
  decision: ComplaintDecision | null,
  reason: ComplaintDecisionReason | null,
  text: string | null,
  at: Date | null,
): Decided | null {
  return decision && reason && text && at
    ? { decision, reason, text, decidedAt: at }
    : null
}

/** Complainant only, this campus. */
export function getOwnComplaint(
  orgId: string,
  code: string,
  userId: string,
  now: Date,
): Promise<OwnComplaint | null> {
  return withTenant(
    orgId,
    async (tx) => {
      const c = contentComplaints
      const [row] = await tx
        .select({
          code: c.publicCode,
          status: c.status,
          reason: c.reason,
          part: c.part,
          explanation: c.explanation,
          createdAt: c.createdAt,
          decision: c.decision,
          decisionReason: c.decisionReason,
          decisionText: c.decisionText,
          decidedAt: c.decidedAt,
          appealText: c.appealText,
          appealedAt: c.appealedAt,
          appealDecision: c.appealDecision,
          appealReason: c.appealReason,
          appealDecisionText: c.appealDecisionText,
          appealDecidedAt: c.appealDecidedAt,
          issueCode: issues.publicCode,
          issueTitle: issues.title,
          publishedAt: issues.publishedAt,
          demandCode: demands.publicCode,
          demandTitle: demands.title,
          demandState: demands.state,
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
        .where(and(eq(c.publicCode, code), eq(c.userId, userId)))
        .limit(1)
      if (!row) return null
      return {
        code: row.code,
        status: row.status,
        reason: row.reason,
        part: row.part,
        explanation: row.explanation,
        createdAt: row.createdAt,
        subject: row.demandCode
          ? {
              kind: "demand",
              code: row.demandCode,
              title: row.demandTitle ?? "",
              published: row.demandState !== "draft",
            }
          : {
              kind: "issue",
              code: row.issueCode ?? "",
              title: row.issueTitle ?? "",
              published: row.publishedAt !== null,
            },
        decision: decided(
          row.decision,
          row.decisionReason,
          row.decisionText,
          row.decidedAt,
        ),
        appeal:
          row.appealText && row.appealedAt
            ? { text: row.appealText, appealedAt: row.appealedAt }
            : null,
        appealDecision: decided(
          row.appealDecision,
          row.appealReason,
          row.appealDecisionText,
          row.appealDecidedAt,
        ),
        canAppeal: appealOpen(row, now),
        appealUntil:
          row.status === "decided" && row.decidedAt
            ? appealDeadline(row.decidedAt)
            : null,
      }
    },
    { role: "reporter" },
  )
}

export type AppealResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "closed" | "length" }

const A = COMPLAINT_LENGTHS.appeal

/** Once, complainant, inside the window. */
export function appealComplaint(
  orgId: string,
  input: { code: string; userId: string; text: string; now: Date },
): Promise<AppealResult> {
  const text = input.text.trim().replaceAll("\r\n", "\n")
  if (text.length < A.min || text.length > A.max) {
    return Promise.resolve({ ok: false, reason: "length" })
  }
  return withTenant(
    orgId,
    async (tx) => {
      const c = contentComplaints
      const [row] = await tx
        .select({ id: c.id, status: c.status, decidedAt: c.decidedAt })
        .from(c)
        .where(and(eq(c.publicCode, input.code), eq(c.userId, input.userId)))
        .for("update")
      if (!row) return { ok: false, reason: "not_found" } as const
      if (!appealOpen(row, input.now)) {
        return { ok: false, reason: "closed" } as const
      }
      const [updated] = await tx
        .update(c)
        .set({
          status: "appealed",
          appealText: text,
          appealedAt: input.now,
          updatedAt: sql`now()`,
        })
        .where(and(eq(c.id, row.id), eq(c.status, "decided")))
        .returning({ id: c.id })
      if (!updated) return { ok: false, reason: "closed" } as const
      await tx.insert(auditLog).values({
        orgId,
        actorId: input.userId,
        action: "complaint.appeal",
        entityType: "complaint",
        entityId: row.id,
      })
      return { ok: true } as const
    },
    { role: "reporter" },
  )
}
