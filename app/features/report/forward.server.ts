import { link, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { sendJob } from "../../../db/jobs.server.ts"
import { notifyReporter } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { members } from "../../../db/schema/auth.ts"
import { organizations } from "../../../db/schema/organizations.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
import { type Tx, withTenant } from "../../../db/tenant.server.ts"
import { defaultFilesDir, originalPath } from "../../../server/files.server.ts"
import { evidenceQueue } from "../../../shared/evidence.ts"
import { REPORT_TRANSITIONS } from "../../../shared/status.ts"
import { nextReportCode } from "./report-code.server.ts"

const FORWARDABLE = REPORT_TRANSITIONS.forward.from
// Rows that have an original
const WITH_FILE = [
  "received",
  "ready",
  "needs_manual_review",
  "published",
] as const

export type ForwardInput = {
  source: { id: string }
  reportId: string
  targetOrgId: string
  actorId: string
  now?: Date
  filesDir?: string
  // Sample seed opts out
  notify?: boolean
}

export type ForwardResult =
  | { ok: true; code: string }
  | {
      ok: false
      reason: "not_found" | "not_allowed" | "changed" | "same_campus"
    }

type Source = typeof reports.$inferSelect
type SourceFile = typeof evidence.$inferSelect

/** Original first, guard wins. */
async function closeOriginal(
  tx: Tx,
  input: ForwardInput,
  target: { slug: string },
): Promise<
  | {
      kind: "moved"
      report: Source
      files: SourceFile[]
      awaiting: SourceFile[]
    }
  | { kind: "refused"; reason: "not_found" | "not_allowed" | "changed" }
> {
  const [report] = await tx
    .select()
    .from(reports)
    .where(eq(reports.id, input.reportId))
    .for("update")
  if (!report) return { kind: "refused", reason: "not_found" }
  const finishing =
    report.status === "forwarded" &&
    report.forwardedToOrgId === input.targetOrgId
  if (!finishing) {
    if (report.status === "forwarded") {
      return { kind: "refused", reason: "changed" }
    }
    if (!FORWARDABLE.includes(report.status)) {
      return { kind: "refused", reason: "not_allowed" }
    }
    await tx
      .update(reports)
      .set({
        status: "forwarded",
        forwardedToOrgId: input.targetOrgId,
        updatedAt: sql`now()`,
      })
      .where(eq(reports.id, report.id))
    await tx.insert(auditLog).values({
      orgId: input.source.id,
      actorId: input.actorId,
      action: "report.forward",
      entityType: "report",
      entityId: report.id,
      changedColumns: ["status", "forwarded_to_org_id"],
      // Names the receiving campus
      reasonCode: target.slug,
    })
  }
  const files = await tx
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.reportId, report.id),
        inArray(evidence.status, WITH_FILE),
      ),
    )
    .orderBy(asc(evidence.position))
  // Reporter uploads these at B
  const awaiting = await tx
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.reportId, report.id),
        eq(evidence.status, "awaiting_upload"),
      ),
    )
    .orderBy(asc(evidence.position))
  return { kind: "moved", report, files, awaiting }
}

async function createCopy(
  tx: Tx,
  input: ForwardInput,
  target: { id: string },
  source: { report: Source; files: SourceFile[]; awaiting: SourceFile[] },
): Promise<string> {
  const { report } = source
  const [copy] = await tx
    .insert(reports)
    .values({
      orgId: target.id,
      userId: report.userId,
      publicCode: await nextReportCode(tx, target.id, input.now ?? new Date()),
      submissionId: crypto.randomUUID(),
      status: "in_review",
      relation: report.relation,
      otherConsent: report.otherConsent,
      provinceCode: report.provinceCode,
      regencyCode: report.regencyCode,
      districtCode: report.districtCode,
      villageCode: report.villageCode,
      point: report.point,
      title: report.title,
      story: report.story,
      categoryId: report.categoryId,
      subcategoryId: report.subcategoryId,
      occurredOn: report.occurredOn,
      agency: report.agency,
      urgency: report.urgency,
      affectedGroups: report.affectedGroups,
      affectedCount: report.affectedCount,
      ongoing: report.ongoing,
      // Contacts stay with campus A
      contactable: false,
      consents: report.consents,
      consentTextVersion: report.consentTextVersion,
      consentedAt: report.consentedAt,
      forwardedFromOrgId: input.source.id,
      forwardedFromReportId: report.id,
      forwardedFromCode: report.publicCode,
    })
    .onConflictDoNothing({
      target: [reports.orgId, reports.forwardedFromReportId],
    })
    .returning({ id: reports.id, code: reports.publicCode })
  if (!copy) {
    const [existing] = await tx
      .select({ code: reports.publicCode })
      .from(reports)
      .where(eq(reports.forwardedFromReportId, report.id))
    if (!existing) throw new Error("forward conflict without a copy")
    return existing.code
  }
  await tx
    .insert(members)
    .values({ organizationId: target.id, userId: report.userId })
    .onConflictDoNothing({ target: [members.organizationId, members.userId] })
  const filesDir = input.filesDir ?? defaultFilesDir()
  for (const file of source.files) {
    const [row] = await tx
      .insert(evidence)
      .values({
        orgId: target.id,
        reportId: copy.id,
        position: file.position,
        kind: file.kind,
        declaredName: file.declaredName,
        declaredType: file.declaredType,
        declaredSize: file.declaredSize,
        status: "received",
        detectedType: file.detectedType,
        byteSize: file.byteSize,
        sha256: file.sha256,
        receivedAt: sql`now()`,
      })
      .returning({ id: evidence.id })
    if (!row) throw new Error("evidence copy not inserted")
    // Same volume, later deletes independent
    const to = originalPath(filesDir, target.id, row.id)
    await mkdir(dirname(to), { recursive: true })
    await link(originalPath(filesDir, input.source.id, file.id), to)
    await sendJob(tx, evidenceQueue(file.kind), {
      orgId: target.id,
      evidenceId: row.id,
    })
  }
  for (const file of source.awaiting) {
    await tx.insert(evidence).values({
      orgId: target.id,
      reportId: copy.id,
      position: file.position,
      kind: file.kind,
      declaredName: file.declaredName,
      declaredType: file.declaredType,
      declaredSize: file.declaredSize,
    })
  }
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId: target.id,
      actorId: input.actorId,
      action: "report.forward_in",
      entityType: "report",
      entityId: copy.id,
      changedColumns: ["forwarded_from_report_id"],
    })
    .returning({ id: auditLog.id })
  if (event && input.notify !== false) {
    // Mail carries campus B link
    await notifyReporter(tx, {
      orgId: target.id,
      reportId: copy.id,
      eventId: event.id,
      template: "report_forwarded",
    })
  }
  return copy.code
}

/** Two tenant transactions, repeat finishes. */
export async function forwardReport(
  input: ForwardInput,
): Promise<ForwardResult> {
  if (input.targetOrgId === input.source.id) {
    return { ok: false, reason: "same_campus" }
  }
  const [target] = await withTenant(input.source.id, (tx) =>
    tx
      .select({
        id: organizations.id,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(eq(organizations.id, input.targetOrgId)),
  )
  if (!target) return { ok: false, reason: "not_found" }
  const closed = await withTenant(
    input.source.id,
    (tx) => closeOriginal(tx, input, target),
    { role: "admin" },
  )
  if (closed.kind === "refused") return { ok: false, reason: closed.reason }
  const code = await withTenant(
    target.id,
    (tx) => createCopy(tx, input, target, closed),
    { role: "admin" },
  )
  return { ok: true, code }
}

export type ForwardTarget = { id: string; name: string }

/** Other campuses, organizations is global. */
export function listForwardTargets(orgId: string): Promise<ForwardTarget[]> {
  return withTenant(orgId, (tx) =>
    tx
      .select({ id: organizations.id, name: organizations.campusName })
      .from(organizations)
      .where(sql`${organizations.id} <> ${orgId}`)
      .orderBy(asc(organizations.campusName)),
  )
}
