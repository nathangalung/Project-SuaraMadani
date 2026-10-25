import { data, type RouterContextProvider, redirect } from "react-router"
import { withTenant } from "../../../db/tenant.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import {
  CLOSE_ACCOUNT_REASONS,
  MODERATION_LENGTHS,
  VERIFY_METHODS,
  type VerifyMethod,
} from "../../../shared/moderation.ts"
import {
  type IssueAction,
  REPORT_STATUSES,
  type ReportStatus,
} from "../../../shared/status.ts"
import { purgeIssuePages, runPublish } from "../issues/publish.server.ts"
import { requireAdmin } from "./access.server.ts"
import { closeAccount } from "./close-account.server.ts"
import {
  type ReporterAccount,
  type ReporterContact,
  revealAccount,
  revealContact,
} from "./contact.server.ts"
import {
  type CloseErrorKey,
  ISSUE_SUMMARY_LENGTH,
  ISSUE_TITLE_LENGTH,
  type IssueErrorKey,
  PUBLISH_CHECKLIST,
  type ReviewErrorKey,
} from "./fields.ts"
import { longText, oneOf, text, UUID, within } from "./form-values.ts"
import {
  type EditErrorKey,
  editIssue,
  type LegalErrorKey,
  parseEditForm,
  parseLegalForm,
} from "./issue-edit.server.ts"
import { parseIssueForm } from "./issue-form.ts"
import { legalTakedown } from "./legal-takedown.server.ts"
import { type MergeTarget, runMerge } from "./merge.server.ts"
import { getManagedIssue, getReviewReport } from "./queue.server.ts"
import { runIssueAction } from "./referrals.server.ts"
import { type ReviewDecision, reviewReport } from "./verify.server.ts"
import { verifyIntoIssue } from "./verify-issue.server.ts"

export type ReviewActionData =
  | { conflict: true }
  | { contact: ReporterContact | null }
  | { account: ReporterAccount | null }
  | { errors: ReviewErrorKey[]; intent: string }

export type IssueActionData =
  | { conflict: true }
  | { unchanged: true }
  | { errors: ["checklist"]; intent: "publish" }
  | { errors: EditErrorKey[]; intent: "edit" }
  | { errors: LegalErrorKey[]; intent: "legal_takedown" }
  | { errors: IssueErrorKey[]; intent: IssueAction }

type ParsedReview =
  | (Exclude<ReviewDecision, { action: "verify" }> & { from: ReportStatus })
  | {
      action: "verify"
      from: ReportStatus
      method: VerifyMethod
      target: MergeTarget
    }
  | { action: "merge"; target: MergeTarget }
  | { errors: ReviewErrorKey[]; intent: string }

const L = MODERATION_LENGTHS

function parseDecision(
  form: FormData,
  intent: "mark_unverifiable",
  from: ReportStatus,
): ParsedReview {
  // Free text only, no codes
  const reasonText = longText(form, "reasonText")
  return within(reasonText, L.reasonText)
    ? { action: intent, from, reasonText }
    : { errors: ["unverifiable_text"], intent }
}

/** Null means a malformed request. */
export function parseReviewForm(form: FormData): ParsedReview | null {
  const intent = text(form, "intent")
  if (intent === "verify" || intent === "mark_unverifiable") {
    const from = oneOf(REPORT_STATUSES, text(form, "from"))
    if (!from) return null
    if (intent !== "verify") return parseDecision(form, intent, from)
    // Verify lands in an issue
    const method = oneOf(VERIFY_METHODS, text(form, "method"))
    const target = parseTarget(form)
    if (!target) return null
    const errors: ReviewErrorKey[] = method ? [] : ["verify_method"]
    if ("errors" in target) errors.push(...target.errors)
    const newIssue = "kind" in target && target.kind === "new"
    if (newIssue && !checklistDone(form)) errors.push("checklist")
    if (errors.length > 0 || !method || "errors" in target) {
      return { errors, intent }
    }
    return { action: intent, from, method, target }
  }
  if (intent !== "merge") return null
  const target = parseTarget(form)
  if (!target) return null
  return "errors" in target
    ? { errors: target.errors, intent }
    : { action: intent, target }
}

function checklistDone(form: FormData): boolean {
  const checked = new Set(form.getAll("checklist"))
  return PUBLISH_CHECKLIST.every((item) => checked.has(item))
}

/** New issue or existing one. */
function parseTarget(
  form: FormData,
): MergeTarget | { errors: ReviewErrorKey[] } | null {
  const target = text(form, "target")
  if (target === "existing") {
    const issueId = text(form, "issueId")
    return UUID.test(issueId)
      ? { kind: "existing", issueId }
      : { errors: ["merge_issue"] }
  }
  if (target !== "new") return null
  const title = text(form, "title")
  const summary = text(form, "summary")
  const errors: ReviewErrorKey[] = []
  if (!within(title, ISSUE_TITLE_LENGTH)) errors.push("issue_title")
  if (!within(summary, ISSUE_SUMMARY_LENGTH)) errors.push("issue_summary")
  return errors.length > 0 ? { errors } : { kind: "new", title, summary }
}

export function parsePublishForm(
  form: FormData,
): { issueId: string } | { errors: ["checklist"] } | null {
  const issueId = text(form, "issueId")
  if (!UUID.test(issueId)) return null
  return checklistDone(form) ? { issueId } : { errors: ["checklist"] }
}

type Args = {
  request: Request
  context: Readonly<RouterContextProvider>
  params: { code?: string }
}

const conflict = () => data({ conflict: true } as const, { status: 409 })

export async function reportPageAction({ request, context, params }: Args) {
  const { tenant, session, role } = await requireAdmin(context)
  const report = await getReviewReport(tenant.id, role, params.code ?? "")
  if (!report) throw data(null, { status: 404 })
  const form = await request.formData()
  if (text(form, "intent") === "show_account") {
    const account = await revealAccount(tenant.id, role, {
      reportId: report.id,
      actorId: session.user.id,
    })
    // Email and number, never cached
    return data<ReviewActionData>(
      { account },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  }
  if (text(form, "intent") === "show_contact") {
    const contact = await revealContact(tenant.id, role, {
      reportId: report.id,
      actorId: session.user.id,
    })
    // Phone number, never cached
    return data<ReviewActionData>(
      { contact },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  }
  const parsed = parseReviewForm(form)
  if (!parsed) throw data(null, { status: 400 })
  if ("errors" in parsed) {
    return data<ReviewActionData>(parsed, { status: 400 })
  }
  const actorId = session.user.id

  if (parsed.action === "verify") {
    const result = await verifyIntoIssue(tenant, role, {
      reportId: report.id,
      from: parsed.from,
      method: parsed.method,
      target: parsed.target,
      actorId,
    })
    if (!result.ok) {
      if (result.reason === "not_found") {
        return data<ReviewActionData>(
          { errors: ["merge_issue"], intent: "verify" },
          { status: 400 },
        )
      }
      if (result.reason === "no_contact_consent") {
        return data<ReviewActionData>(
          { errors: ["verify_contact"], intent: "verify" },
          { status: 400 },
        )
      }
      return conflict()
    }
    throw redirect(`/kelola/isu/${result.code}`, 303)
  }

  if (parsed.action === "merge") {
    const merged = await runMerge(tenant.id, {
      reportIds: [report.id],
      target: parsed.target,
      actorId,
      now: new Date(),
    })
    if (!merged.ok) {
      return merged.reason === "not_found"
        ? data<ReviewActionData>(
            { errors: ["merge_issue"], intent: "merge" },
            { status: 400 },
          )
        : conflict()
    }
    if (merged.published) await purgeIssuePages(tenant.host, merged)
    throw redirect(`/kelola/isu/${merged.code}`, 303)
  }

  const result = await withTenant(
    tenant.id,
    (tx) =>
      reviewReport(tx, tenant.id, { reportId: report.id, actorId, ...parsed }),
    { role },
  )
  if (!result.ok && result.reason === "no_contact_consent") {
    return data<ReviewActionData>(
      { errors: ["verify_contact"], intent: "verify" },
      { status: 400 },
    )
  }
  if (!result.ok) return conflict()
  throw redirect(`/kelola/laporan/${report.code}`, 303)
}

export async function issuePageAction({ request, context, params }: Args) {
  const { tenant, session, role } = await requireAdmin(context)
  const issue = await getManagedIssue(tenant.id, role, params.code ?? "")
  if (!issue) throw data(null, { status: 404 })
  const form = await request.formData()
  const actorId = session.user.id

  if (text(form, "intent") === "publish") {
    const parsed = parsePublishForm(form)
    if (!parsed) throw data(null, { status: 400 })
    if ("errors" in parsed) {
      return data<IssueActionData>(
        { errors: parsed.errors, intent: "publish" },
        { status: 400 },
      )
    }
    if (parsed.issueId !== issue.id) throw data(null, { status: 400 })
    const result = await runPublish(
      { id: tenant.id, host: tenant.host },
      { issueId: issue.id, actorId },
    )
    if (!result.ok) return conflict()
    throw redirect(`/kelola/isu/${issue.code}`, 303)
  }

  if (text(form, "intent") === "edit") {
    const parsed = await parseEditForm(form)
    if (!parsed) throw data(null, { status: 400 })
    if (!parsed.ok) {
      return data<IssueActionData>(
        { errors: parsed.errors, intent: "edit" },
        { status: 400 },
      )
    }
    const result = await editIssue(
      { id: tenant.id, host: tenant.host },
      { ...parsed.value, issueId: issue.id, actorId },
    )
    if (!result.ok) {
      if (result.reason === "unchanged") {
        return data<IssueActionData>({ unchanged: true })
      }
      return conflict()
    }
    throw redirect(`/kelola/isu/${issue.code}`, 303)
  }

  if (text(form, "intent") === "legal_takedown") {
    const parsed = parseLegalForm(form)
    if (!parsed) throw data(null, { status: 400 })
    if (!parsed.ok) {
      return data<IssueActionData>(
        { errors: parsed.errors, intent: "legal_takedown" },
        { status: 400 },
      )
    }
    const result = await legalTakedown(tenant, {
      ...parsed.value,
      issueId: issue.id,
      actorId,
    })
    if (!result.ok) return conflict()
    throw redirect(`/kelola/isu/${issue.code}`, 303)
  }

  const parsed = parseIssueForm(form, jakartaIsoDate(new Date()))
  if (!parsed) throw data(null, { status: 400 })
  if ("errors" in parsed) {
    return data<IssueActionData>(
      { errors: parsed.errors, intent: parsed.action },
      { status: 400 },
    )
  }
  const result = await runIssueAction(
    { id: tenant.id, host: tenant.host },
    { ...parsed, issueId: issue.id, actorId },
  )
  if (!result.ok) return conflict()
  throw redirect(`/kelola/isu/${issue.code}#riwayat`, 303)
}

export type CloseAccountActionData =
  | { errors: CloseErrorKey[] }
  | { done: { reports: number; issues: string[]; unpublished: string[] } }

export async function closeAccountAction({ request, context, params }: Args) {
  const { tenant, session, role } = await requireAdmin(context)
  const report = await getReviewReport(tenant.id, role, params.code ?? "")
  if (!report) throw data(null, { status: 404 })
  const form = await request.formData()
  const reason = oneOf(CLOSE_ACCOUNT_REASONS, text(form, "reason"))
  const errors: CloseErrorKey[] = []
  if (!reason) errors.push("close_reason")
  if (text(form, "confirm") !== "yes") errors.push("close_confirm")
  if (!reason || errors.length > 0) {
    return data<CloseAccountActionData>({ errors }, { status: 400 })
  }
  const result = await closeAccount({
    tenant: { id: tenant.id, host: tenant.host },
    reportId: report.id,
    reason,
    actorId: session.user.id,
  })
  if (!result.ok) {
    // Staff accounts are never closed
    throw data(null, { status: result.reason === "staff" ? 403 : 404 })
  }
  const { ok: _ok, ...done } = result
  return { done } satisfies CloseAccountActionData
}
