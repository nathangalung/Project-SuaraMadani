import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm"
import { data } from "react-router"
import { database } from "../../../db/client.server.ts"
import { notifyReporter } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { members } from "../../../db/schema/auth.ts"
import { regions } from "../../../db/schema/regions.ts"
import {
  evidence,
  reportContacts,
  reports,
} from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { globalIntakePause } from "../../../server/intake.server.ts"
import {
  type TurnstileResult,
  turnstileSecret,
  verifyTurnstile,
} from "../../../server/turnstile.server.ts"
import { latestIsoDate } from "../../../shared/format.ts"
import {
  REPORT_ERROR_KEYS,
  type ReportErrorKey,
} from "../../../shared/report-fields.ts"
import {
  createReportSchema,
  type Report,
} from "../../../shared/report-schema.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import { nextReportCode } from "./report-code.server.ts"

export type SubmitDeps = {
  now: () => Date
  intakePaused: boolean
  verifyCaptcha: (
    token: string | null,
    remoteIp: string | null,
    idempotencyKey: string,
  ) => Promise<TurnstileResult>
}

export type SubmittedReport = {
  code: string
  evidence: { id: string; position: number }[]
}
export type SubmitFieldError = { path: string; key: ReportErrorKey }
export type SubmitFailure =
  | "sign_in_required"
  | "captcha_failed"
  | "quota_exceeded"
  | "intake_paused"
  | "too_large"

export type SubmitResult =
  | { status: 200 | 201; body: SubmittedReport }
  | { status: 400; body: { errors: SubmitFieldError[] } }
  | { status: 401 | 403 | 413 | 429 | 503; body: { error: SubmitFailure } }

// Starting Values: business quotas
const DAILY_REPORTS = 5
// Story max 5000 chars fits
const MAX_BODY_BYTES = 64 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ERROR_KEYS = new Set<string>(REPORT_ERROR_KEYS)

function fail(status: 401 | 403 | 413 | 429 | 503, error: SubmitFailure) {
  return { status, body: { error } } as const
}

function fieldErrors(errors: SubmitFieldError[]): SubmitResult {
  return { status: 400, body: { errors } }
}

function readString(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" ? value : null
}

/** Existing report for this key. */
async function findSubmission(
  tx: Tx,
  userId: string,
  submissionId: string,
): Promise<SubmittedReport | null> {
  const [row] = await tx
    .select({ id: reports.id, code: reports.publicCode })
    .from(reports)
    .where(
      and(eq(reports.userId, userId), eq(reports.submissionId, submissionId)),
    )
    .limit(1)
  if (!row) return null
  const files = await tx
    .select({ id: evidence.id, position: evidence.position })
    .from(evidence)
    .where(eq(evidence.reportId, row.id))
    .orderBy(asc(evidence.position))
  return { code: row.code, evidence: files }
}

function lookup(
  tenantId: string,
  userId: string,
  submissionId: string,
): Promise<SubmittedReport | null> {
  return withTenant(
    tenantId,
    (tx) => findSubmission(tx, userId, submissionId),
    { role: "reporter" },
  )
}

function zodErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): SubmitFieldError[] {
  const seen = new Set<string>()
  const errors: SubmitFieldError[] = []
  for (const issue of issues) {
    const path = issue.path.map(String).join(".")
    if (seen.has(path)) continue
    seen.add(path)
    const key = ERROR_KEYS.has(issue.message)
      ? (issue.message as ReportErrorKey)
      : "error_step_required"
    errors.push({ path, key })
  }
  return errors
}

/** Region codes must exist. */
async function regionErrors(report: Report): Promise<SubmitFieldError[]> {
  const { provinceCode, regencyCode, districtCode, villageCode } =
    report.location
  const wanted: [string, string | undefined, ReportErrorKey][] = [
    ["provinceCode", provinceCode, "error_province_required"],
    ["regencyCode", regencyCode, "error_regency_required"],
    ["districtCode", districtCode, "error_district_required"],
    ["villageCode", villageCode, "error_village_format"],
  ]
  const codes = wanted.flatMap(([, code]) => (code ? [code] : []))
  const found = await database()
    .db.select({ code: regions.code })
    .from(regions)
    .where(inArray(regions.code, codes))
  const known = new Set(found.map((row) => row.code))
  return wanted.flatMap(([field, code, key]) =>
    code && !known.has(code) ? [{ path: `location.${field}`, key }] : [],
  )
}

type Inserted =
  | { kind: "created" | "existing"; report: SubmittedReport }
  | { kind: "quota" }

async function insertReport(
  tx: Tx,
  input: {
    tenant: TenantContext
    userId: string
    report: Report
    // Account number, E.164
    phone: string | null
    now: Date
  },
): Promise<Inserted> {
  const { tenant, userId, report, phone, now } = input
  // Serialises one user's submits
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`,
  )
  const existing = await findSubmission(tx, userId, report.submissionId)
  if (existing) return { kind: "existing", report: existing }

  const [recent] = await tx
    .select({ n: count() })
    .from(reports)
    .where(
      and(
        eq(reports.userId, userId),
        gt(reports.createdAt, sql`now() - interval '24 hours'`),
      ),
    )
  if ((recent?.n ?? 0) >= DAILY_REPORTS) return { kind: "quota" }

  const { relation, location, details, impact, contact, consent } = report
  const [row] = await tx
    .insert(reports)
    .values({
      orgId: tenant.id,
      userId,
      publicCode: await nextReportCode(tx, tenant.id, now),
      submissionId: report.submissionId,
      relation: relation.relation,
      otherConsent:
        relation.relation === "on_behalf" ? relation.otherConsent : null,
      provinceCode: location.provinceCode,
      regencyCode: location.regencyCode,
      districtCode: location.districtCode,
      villageCode: location.villageCode ?? null,
      point: location.point ?? null,
      title: details.title,
      story: details.story,
      categoryId: details.categoryId,
      subcategoryId: details.subcategoryId,
      occurredOn: details.occurredOn,
      agency: details.agency ?? null,
      urgency: details.urgency,
      affectedGroups: impact.groups,
      affectedCount: impact.affectedCount,
      ongoing: impact.ongoing,
      contactable: contact.contactable === "yes",
      consents: consent.consents,
      consentTextVersion: consent.consentTextVersion,
    })
    // Code collisions must still throw
    .onConflictDoNothing({
      target: [reports.orgId, reports.userId, reports.submissionId],
    })
    .returning({ id: reports.id, code: reports.publicCode })
  if (!row) {
    const found = await findSubmission(tx, userId, report.submissionId)
    if (!found) throw new Error("Submission conflict without a row")
    return { kind: "existing", report: found }
  }

  if (contact.contactable === "yes" && phone) {
    // No RETURNING: reporter cannot read
    await tx.insert(reportContacts).values({
      orgId: tenant.id,
      reportId: row.id,
      phone,
      method: contact.method,
    })
  }
  await tx
    .insert(members)
    .values({ organizationId: tenant.id, userId, role: "reporter" })
    .onConflictDoNothing({ target: [members.organizationId, members.userId] })
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId: tenant.id,
      actorId: userId,
      action: "report.submit",
      entityType: "report",
      entityId: row.id,
    })
    .returning({ id: auditLog.id })
  if (!event) throw new Error("audit row not inserted")
  // Receipt, PLAN §14 item 11
  await notifyReporter(tx, {
    orgId: tenant.id,
    reportId: row.id,
    eventId: event.id,
    template: "report_submitted",
  })
  const files =
    report.evidence.length === 0
      ? []
      : await tx
          .insert(evidence)
          .values(
            report.evidence.map((file, position) => ({
              orgId: tenant.id,
              reportId: row.id,
              position,
              kind: file.kind,
              declaredName: file.name,
              declaredType: file.type,
              declaredSize: file.size,
            })),
          )
          .returning({ id: evidence.id, position: evidence.position })
  files.sort((a, b) => a.position - b.position)
  return { kind: "created", report: { code: row.code, evidence: files } }
}

/** Step-7 action body to result. */
export async function handleSubmit(input: {
  body: unknown
  tenant: TenantContext
  session: SessionContext | null
  remoteIp: string | null
  deps: SubmitDeps
}): Promise<SubmitResult> {
  const { body, tenant, session, deps } = input
  if (deps.intakePaused || tenant.settings.intakePaused) {
    return fail(503, "intake_paused")
  }
  if (!session) return fail(401, "sign_in_required")
  const userId = session.user.id

  const submissionId = readString(body, "submissionId")
  if (submissionId && UUID.test(submissionId)) {
    const existing = await lookup(tenant.id, userId, submissionId)
    if (existing) return { status: 200, body: existing }
  }

  const now = deps.now()
  const parsed = createReportSchema(latestIsoDate(now)).safeParse(body)
  if (!parsed.success) return fieldErrors(zodErrors(parsed.error.issues))
  const report = parsed.data
  const invalid = await regionErrors(report)
  if (invalid.length > 0) return fieldErrors(invalid)
  const phone = session.user.phoneNumber ?? null
  if (report.contact.contactable === "yes" && !phone) {
    return fieldErrors([
      { path: "contact.contactable", key: "error_contact_no_phone" },
    ])
  }
  // Admins call this number
  if (report.contact.contactable === "yes" && !session.user.phoneVerified) {
    return fieldErrors([
      { path: "contact.contactable", key: "error_contact_phone_unverified" },
    ])
  }

  const captcha = await deps.verifyCaptcha(
    readString(body, "turnstileToken"),
    input.remoteIp,
    report.submissionId,
  )
  if (!captcha.ok) {
    // Loser of a double submit
    if (captcha.reason === "duplicate") {
      const existing = await lookup(tenant.id, userId, report.submissionId)
      if (existing) return { status: 200, body: existing }
    }
    return fail(403, "captcha_failed")
  }

  const inserted = await withTenant(
    tenant.id,
    (tx) => insertReport(tx, { tenant, userId, report, phone, now }),
    { role: "reporter" },
  )
  if (inserted.kind === "quota") return fail(429, "quota_exceeded")
  return {
    status: inserted.kind === "created" ? 201 : 200,
    body: inserted.report,
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/** Step-7 action wiring. */
export async function submitAction(input: {
  request: Request
  tenant: TenantContext
  session: SessionContext | null
}) {
  const { request } = input
  const length = Number(request.headers.get("content-length") ?? 0)
  const result: SubmitResult =
    length > MAX_BODY_BYTES
      ? fail(413, "too_large")
      : await handleSubmit({
          body: await readJson(request),
          tenant: input.tenant,
          session: input.session,
          remoteIp: request.headers.get("x-client-ip"),
          deps: {
            now: () => new Date(),
            intakePaused: globalIntakePause(),
            verifyCaptcha: (token, ip, idempotencyKey) =>
              verifyTurnstile(token, {
                secret: turnstileSecret(),
                remoteIp: ip,
                idempotencyKey,
              }),
          },
        })
  return data(result.body, { status: result.status })
}
