import { and, eq, sql } from "drizzle-orm"
import { notifyReporter } from "../../../db/notifications.server.ts"
import { auditLog } from "../../../db/schema/audit.ts"
import { moderationDecisions } from "../../../db/schema/moderation.ts"
import { reports } from "../../../db/schema/reports.ts"
import type { Tx } from "../../../db/tenant.server.ts"
import type {
  RejectReason,
  UnverifiableReason,
  VerifyMethod,
} from "../../../shared/moderation.ts"
import { templateForReport } from "../../../shared/notifications.ts"
import {
  canTransitionReport,
  type ReportStatus,
  transitionReport,
} from "../../../shared/status.ts"

export type ReviewDecision =
  | { action: "start_review" }
  | { action: "verify"; method: VerifyMethod }
  | { action: "reject"; reason: RejectReason; reasonText: string }
  | {
      action: "mark_unverifiable"
      reason: UnverifiableReason
      reasonText: string
    }

export type ReviewInput = {
  reportId: string
  from: ReportStatus
  actorId: string
} & ReviewDecision

export type ReviewResult =
  | { ok: true; status: ReportStatus }
  | { ok: false; reason: "changed" | "not_allowed" | "no_contact_consent" }

// Sample seed opts out
export type NotifyOption = { notify?: boolean }

function reasonOf(input: ReviewInput) {
  switch (input.action) {
    case "start_review":
      return null
    case "verify":
      return { code: input.method, text: null }
    default:
      return { code: input.reason, text: input.reasonText }
  }
}

/** CAS on the seen status. */
export async function reviewReport(
  tx: Tx,
  orgId: string,
  input: ReviewInput,
  options: NotifyOption = {},
): Promise<ReviewResult> {
  if (!canTransitionReport(input.from, input.action)) {
    return { ok: false, reason: "not_allowed" }
  }
  const { next } = transitionReport(input.from, input.action)
  const verifying = input.action === "verify"
  // Only reporters who agreed
  if (verifying && input.method === "reporter_contact") {
    const [row] = await tx
      .select({ contactable: reports.contactable })
      .from(reports)
      .where(and(eq(reports.id, input.reportId), eq(reports.orgId, orgId)))
    if (row && !row.contactable) {
      return { ok: false, reason: "no_contact_consent" }
    }
  }
  const updated = await tx
    .update(reports)
    .set({
      status: next,
      updatedAt: sql`now()`,
      ...(verifying ? { verifiedAt: sql`now()` } : {}),
    })
    .where(
      and(
        eq(reports.id, input.reportId),
        eq(reports.orgId, orgId),
        eq(reports.status, input.from),
      ),
    )
    .returning({ id: reports.id })
  if (updated.length === 0) return { ok: false, reason: "changed" }
  const reason = reasonOf(input)
  if (reason && input.action !== "start_review") {
    await tx.insert(moderationDecisions).values({
      orgId,
      reportId: input.reportId,
      action: input.action,
      reasonCode: reason.code,
      reasonText: reason.text,
      decidedBy: input.actorId,
    })
  }
  const [event] = await tx
    .insert(auditLog)
    .values({
      orgId,
      actorId: input.actorId,
      action: `report.${input.action}`,
      entityType: "report",
      entityId: input.reportId,
      changedColumns: verifying ? ["status", "verified_at"] : ["status"],
      // Code only, text stays redactable
      reasonCode: reason?.code ?? null,
    })
    .returning({ id: auditLog.id })
  if (event && options.notify !== false) {
    await notifyReporter(tx, {
      orgId,
      reportId: input.reportId,
      eventId: event.id,
      template: templateForReport(next),
    })
  }
  return { ok: true, status: next }
}
