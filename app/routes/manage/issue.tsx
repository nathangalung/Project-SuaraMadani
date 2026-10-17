import { data, Link } from "react-router"
import { errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { ReferralLines, ResponseList } from "~/features/issues/issue-record"
import { IssueStatus } from "~/features/issues/issue-status"
import { latestReferral } from "~/features/issues/record.server"
import { issueHistory, Timeline } from "~/features/issues/timeline"
import { requireAdmin } from "~/features/moderation/access.server"
import {
  EditIssueForm,
  editErrors,
  LegalTakedownForm,
  legalErrors,
} from "~/features/moderation/issue-admin-forms"
import { IssueActions, issueErrors } from "~/features/moderation/issue-forms"
import { getManagedIssue } from "~/features/moderation/queue.server"
import { issuePageAction } from "~/features/moderation/review-actions.server"
import {
  PublishForm,
  ReviewNotices,
  reviewErrors,
} from "~/features/moderation/review-forms"
import { useSiteTitle } from "~/features/report/page-title"
import { regencyGroups } from "~/features/report/regions.server"
import { m } from "~/paraglide/messages.js"
import { formatDate, jakartaIsoDate } from "../../../shared/format.ts"
import { addDays, referralWait } from "../../../shared/moderation.ts"
import { allowedIssueActions } from "../../../shared/status.ts"
import type { Route } from "./+types/issue"

// Prefill only, admin edits it
const DEFAULT_DEADLINE_DAYS = 14

export async function loader({ params, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const issue = await getManagedIssue(tenant.id, role, params.code)
  if (!issue) throw data(null, { status: 404 })
  const regencies = issue.takenDownAt ? [] : await regencyGroups()
  const now = new Date()
  const today = jakartaIsoDate(now)
  const state = { advocacy: issue.advocacyStatus, government: issue.govStatus }
  const referral = latestReferral(issue.record, "referral")
  return {
    issue,
    regencies,
    state,
    actions: issue.publishedAt ? allowedIssueActions(state) : [],
    referral,
    escalation: latestReferral(issue.record, "escalation"),
    wait: referral ? referralWait(referral, issue.govStatus, now) : null,
    defaults: {
      today,
      deadline: addDays(today, DEFAULT_DEADLINE_DAYS),
      agency: referral?.agency ?? "",
    },
  }
}

export const action = issuePageAction

const LINK = "font-semibold text-accent underline underline-offset-4"
const SECTION = "mt-12 border-ink border-t-2 pt-6"
const H2 = "font-bold text-2xl"

export default function ManageIssue({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { issue, state, actions, defaults } = loaderData
  const failed = actionData && "errors" in actionData ? actionData : undefined
  const publishErrors =
    failed?.intent === "publish" ? reviewErrors(failed.errors) : []
  const edit = failed?.intent === "edit" ? editErrors(failed.errors) : []
  const legal =
    failed?.intent === "legal_takedown"
      ? legalErrors(failed.errors, Boolean(issue.publishedAt))
      : []
  const actionErrors =
    failed &&
    failed.intent !== "publish" &&
    failed.intent !== "edit" &&
    failed.intent !== "legal_takedown"
      ? {
          action: failed.intent,
          errors: issueErrors(failed.intent, failed.errors),
        }
      : null
  const errors = actionErrors?.errors ?? [...publishErrors, ...edit, ...legal]
  const unchanged = Boolean(actionData && "unchanged" in actionData)
  const declined = issue.reports.filter((r) => !r.forwardConsent).length
  const conflict = Boolean(actionData && "conflict" in actionData)
  const title = m.manage_issue_page_title({ code: issue.code })
  const pageTitle = useSiteTitle(title)
  const { responses } = issue.record
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0 || conflict)}</title>
      <ReviewNotices conflict={conflict} errors={errors} attempt={actionData} />
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 font-semibold">
        {issue.publishedAt
          ? m.manage_issue_published({ date: formatDate(issue.publishedAt) })
          : issue.takenDownAt
            ? m.manage_issue_taken_down()
            : m.manage_issue_unpublished()}
        {" · "}
        {m.issue_reports({ count: issue.reportCount })}
      </p>
      <h2 className="mt-8 font-bold text-2xl">{issue.title}</h2>
      <div className="mt-3">
        <IssueStatus
          verificationLabel={issue.verificationLabel}
          advocacyStatus={issue.advocacyStatus}
          govStatus={issue.govStatus}
        />
      </div>
      <p className="mt-3 text-ink-muted">{issue.regencyName}</p>
      <div className="mt-3">
        <ReferralLines
          referral={loaderData.referral}
          escalation={loaderData.escalation}
          wait={loaderData.wait}
        />
      </div>
      <p className="mt-4 whitespace-pre-line">{issue.summary}</p>

      {issue.publishedAt ? (
        <>
          <section aria-labelledby="issue-actions" className={SECTION}>
            <h2 id="issue-actions" className={H2}>
              {m.manage_actions_title()}
            </h2>
            <p className="mt-1 mb-5 font-ui text-[0.95rem] text-ink-soft">
              {m.manage_actions_lead()}
            </p>
            {declined > 0 ? (
              <Note tone="info" className="mb-5">
                {m.manage_issue_no_forward_consent({ count: declined })}
              </Note>
            ) : null}
            <IssueActions
              actions={actions}
              state={state}
              version={issue.version}
              failed={actionErrors}
              defaults={defaults}
            />
          </section>
          <section aria-labelledby="issue-responses" className={SECTION}>
            <h2 id="issue-responses" className={H2}>
              {m.issue_response_title()}
            </h2>
            {responses.length > 0 ? (
              <ResponseList responses={responses} />
            ) : (
              <p className="mt-3 text-ink-muted">{m.issue_response_empty()}</p>
            )}
          </section>
          <section
            id="riwayat"
            aria-labelledby="issue-history"
            className={SECTION}
          >
            <h2 id="issue-history" className={H2}>
              {m.issue_history_title()}
            </h2>
            <Timeline
              className="mt-6 ml-1.5"
              entries={issueHistory({
                publishedAt: issue.publishedAt,
                record: issue.record,
              })}
            />
          </section>
        </>
      ) : issue.takenDownAt ? (
        <Note tone="info" className="mt-10">
          {m.manage_issue_taken_down_note({
            date: formatDate(issue.takenDownAt),
          })}
        </Note>
      ) : (
        <section aria-labelledby="issue-publish" className={SECTION}>
          <h2 id="issue-publish" className={`mb-4 ${H2}`}>
            {m.manage_publish_title()}
          </h2>
          <PublishForm issueId={issue.id} errors={publishErrors} />
        </section>
      )}

      {issue.takenDownAt ? null : (
        <section aria-labelledby="issue-manage" className={SECTION}>
          <h2 id="issue-manage" className={`mb-5 ${H2}`}>
            {m.manage_issue_admin_title()}
          </h2>
          <div className="flex flex-col gap-3">
            <EditIssueForm
              issue={issue}
              regencies={loaderData.regencies}
              errors={edit}
              unchanged={unchanged}
            />
            <LegalTakedownForm
              version={issue.version}
              published={Boolean(issue.publishedAt)}
              errors={legal}
            />
          </div>
        </section>
      )}

      <section aria-labelledby="issue-reports" className={SECTION}>
        <h2 id="issue-reports" className={H2}>
          {m.manage_issue_reports_title()}
        </h2>
        <ul className="mt-3 flex flex-col gap-1">
          {issue.reports.map((report) => (
            <li key={report.code}>
              <Link to={`/kelola/laporan/${report.code}`} className={LINK}>
                {report.code}
              </Link>{" "}
              · {report.title}
              {report.forwardConsent
                ? null
                : ` · ${m.manage_issue_report_no_forward()}`}
            </li>
          ))}
        </ul>
      </section>

      {issue.publishedAt ? (
        <p className="mt-10">
          <Link to={`/isu/${issue.code}`} className={LINK}>
            {m.manage_view_public()}
          </Link>
        </p>
      ) : null}
    </div>
  )
}
