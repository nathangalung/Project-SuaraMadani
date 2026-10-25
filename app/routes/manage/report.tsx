import { data, Form, Link } from "react-router"
import { Button } from "~/components/ui/button"
import { errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { requireAdmin } from "~/features/moderation/access.server"
import { AccountSection } from "~/features/moderation/account-section"
import { ActionPanel } from "~/features/moderation/action-panel"
import type { ReporterContact } from "~/features/moderation/contact.server"
import {
  getReviewReport,
  listMergeTargets,
} from "~/features/moderation/queue.server"
import {
  EvidenceList,
  ReportDetails,
} from "~/features/moderation/report-details"
import { reportPageAction } from "~/features/moderation/review-actions.server"
import {
  MergeForm,
  ReviewNotices,
  reviewErrors,
  UnverifiableForm,
  VerifyForm,
} from "~/features/moderation/review-forms"
import { METHOD_TEXT } from "~/features/report/labels"
import { useSiteTitle } from "~/features/report/page-title"
import { REPORT_STATUS_TEXT } from "~/features/report/public-labels"
import { m } from "~/paraglide/messages.js"
import { allowedReportActions } from "../../../shared/status.ts"
import type { Route } from "./+types/report"

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const report = await getReviewReport(tenant.id, role, params.code)
  if (!report) throw data(null, { status: 404 })
  const actions = allowedReportActions(report.status)
  const search = new URL(request.url).searchParams.get("cari") ?? ""
  return {
    report,
    actions,
    search,
    // Verify picks the issue too
    targets:
      actions.includes("merge") || actions.includes("verify")
        ? await listMergeTargets(tenant.id, role, {
            regencyCode: report.regencyCode,
            title: report.title,
            query: search,
          })
        : [],
  }
}

export const action = reportPageAction

const LINK = "font-semibold text-accent underline underline-offset-4"
const H2 = "font-bold text-2xl"

/** PLAN §5.5, opened on request. */
function ContactSection({
  contact,
}: {
  // Undefined until asked
  contact: ReporterContact | null | undefined
}) {
  return (
    <section aria-labelledby="report-contact" className="mt-10">
      <h2 id="report-contact" className={H2}>
        {m.manage_contact_title()}
      </h2>
      <p className="mt-1 mb-4 text-[0.95rem] text-ink-soft">
        {m.manage_contact_lead()}
      </p>
      {contact === undefined ? (
        <Form method="post">
          <input type="hidden" name="intent" value="show_contact" />
          <Button type="submit" variant="secondary">
            {m.manage_contact_show()}
          </Button>
        </Form>
      ) : contact === null ? (
        <p>{m.manage_contact_missing()}</p>
      ) : (
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="font-semibold">{m.manage_contact_name()}</dt>
          <dd>{contact.name || m.manage_contact_name_none()}</dd>
          <dt className="font-semibold">{m.manage_contact_method()}</dt>
          <dd>{METHOD_TEXT[contact.method]()}</dd>
          <dt className="font-semibold">{m.manage_contact_number()}</dt>
          <dd>
            <a href={`tel:${contact.phone}`} className={LINK}>
              {contact.phone}
            </a>
          </dd>
        </dl>
      )}
    </section>
  )
}

export default function ManageReport({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { report, actions, targets } = loaderData
  const failed = actionData && "errors" in actionData ? actionData : undefined
  const errors = failed ? reviewErrors(failed.errors) : []
  const conflict = Boolean(actionData && "conflict" in actionData)
  const title = m.manage_report_title({ code: report.code })
  const pageTitle = useSiteTitle(title)
  const opened = (intent: string) => failed?.intent === intent
  const decided = actions.length > 0 || report.issue
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0 || conflict)}</title>
      <ReviewNotices conflict={conflict} errors={errors} attempt={actionData} />
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 font-semibold">
        {REPORT_STATUS_TEXT[report.status]()}
      </p>

      <section aria-labelledby="report-content" className="mt-8">
        <h2 id="report-content" className={H2}>
          {m.manage_section_report()}
        </h2>
        <ReportDetails report={report} />
      </section>

      <AccountSection
        code={report.code}
        account={
          actionData && "account" in actionData ? actionData.account : undefined
        }
      />

      {report.contactable ? (
        <ContactSection
          contact={
            actionData && "contact" in actionData
              ? actionData.contact
              : undefined
          }
        />
      ) : null}

      <section aria-labelledby="report-evidence" className="mt-10">
        <h2 id="report-evidence" className={`mb-4 ${H2}`}>
          {m.manage_section_evidence()}
        </h2>
        <EvidenceList report={report} />
      </section>

      <section
        aria-labelledby="report-decision"
        className="mt-10 flex flex-col gap-6"
      >
        <h2 id="report-decision" className={H2}>
          {m.manage_section_decision()}
        </h2>
        {report.decision ? (
          <Note>
            <p className="font-semibold">{m.manage_decision_text()}</p>
            <p className="mt-1 whitespace-pre-line">{report.decision.text}</p>
          </Note>
        ) : null}
        {report.issue ? (
          <p>
            {m.manage_merged_into({ code: report.issue.code })}{" "}
            <Link to={`/kelola/isu/${report.issue.code}`} className={LINK}>
              {m.manage_open_issue({ code: report.issue.code })}
            </Link>
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          {actions.includes("verify") ? (
            <ActionPanel
              id="aksi-verify"
              title={m.manage_verify()}
              open={opened("verify") || loaderData.search !== ""}
            >
              <VerifyForm
                from={report.status}
                contactable={report.contactable}
                errors={errors}
                defaultTitle={report.title}
                targets={targets}
                search={loaderData.search}
              />
            </ActionPanel>
          ) : null}
          {actions.includes("merge") ? (
            <ActionPanel
              id="aksi-merge"
              title={m.manage_merge_title()}
              open={opened("merge") || loaderData.search !== ""}
            >
              <MergeForm
                defaultTitle={report.title}
                targets={targets}
                search={loaderData.search}
                errors={errors}
              />
            </ActionPanel>
          ) : null}
          {actions.includes("mark_unverifiable") ? (
            <ActionPanel
              id="aksi-mark_unverifiable"
              title={m.manage_action_mark_unverifiable()}
              open={opened("mark_unverifiable")}
            >
              <UnverifiableForm from={report.status} errors={errors} />
            </ActionPanel>
          ) : null}
        </div>
        {!decided ? <p>{m.manage_no_action()}</p> : null}
      </section>
    </div>
  )
}
