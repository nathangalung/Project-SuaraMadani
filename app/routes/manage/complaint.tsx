import { data, Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { errorTitle } from "~/components/ui/error-summary"
import { Note } from "~/components/ui/note"
import { Table, Td, Th } from "~/components/ui/table"
import { STATE_TEXT } from "~/features/demands/labels"
import { requireAdmin } from "~/features/moderation/access.server"
import { complaintPageAction } from "~/features/moderation/complaint-actions.server"
import {
  DECISION_ACTION_TEXT,
  DecisionPanels,
  decideErrors,
} from "~/features/moderation/complaint-forms"
import {
  COMPLAINT_REASON_TEXT,
  COMPLAINT_STATUS_TEXT,
  complaintOutcomeText,
  complaintPartText,
  complaintReasonText,
} from "~/features/moderation/complaint-labels"
import { getComplaint } from "~/features/moderation/complaints.server"
import { ReviewNotices } from "~/features/moderation/review-forms"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import {
  COMPLAINT_SLA_DAYS,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  complaintStage,
} from "../../../shared/complaints.ts"
import { formatDate, formatDateTime } from "../../../shared/format.ts"
import type { PurgeStatus, TakedownAction } from "../../../shared/moderation.ts"
import type { Route } from "./+types/complaint"

const DAY_MS = 86_400_000

export async function loader({ params, context }: Route.LoaderArgs) {
  const { tenant, role, session } = await requireAdmin(context)
  const complaint = await getComplaint(tenant.id, role, params.code)
  if (!complaint) throw data(null, { status: 404 })
  const stage = complaintStage(complaint.status)
  return {
    complaint,
    stage,
    // SQL CHECK is the backstop
    blocked: stage === "appeal" && complaint.first?.by === session.user.id,
    viewer: session.user.id,
    dueAt: new Date(
      complaint.createdAt.getTime() + COMPLAINT_SLA_DAYS * DAY_MS,
    ),
  }
}

export const action = complaintPageAction

const KIND_TEXT = {
  image: m.evidence_kind_image,
  pdf: m.evidence_kind_pdf,
  video: m.evidence_kind_video,
} as const

const TAKEDOWN_TEXT: Record<TakedownAction, () => string> = {
  redact: m.manage_takedown_redact,
  unpublish: m.manage_takedown_unpublish,
  take_down: m.manage_takedown_take_down,
  remove_on_request: m.manage_takedown_remove_on_request,
}

const PURGE_TEXT: Record<PurgeStatus, () => string> = {
  pending: m.manage_purge_pending,
  retrying: m.manage_purge_retrying,
  done: m.manage_purge_done,
}

const LINK = "font-semibold text-accent underline underline-offset-4"
const SECTION = "mt-12 border-ink border-t-2 pt-6"
const H2 = "font-bold text-2xl"
const DL = "mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]"

type Decided = {
  decision: ComplaintDecision
  reason: ComplaintDecisionReason
  text: string
  by: string
  at: Date
}

function DecisionBlock({
  title,
  value,
  viewer,
  kind,
}: {
  title: string
  value: Decided
  viewer: string
  kind: "issue" | "demand"
}) {
  return (
    <div className="mt-6">
      <h3 className="font-bold text-lg">{title}</h3>
      <dl className={DL}>
        <dt className="font-semibold">{m.complaint_fact_outcome()}</dt>
        <dd>{complaintOutcomeText(value.decision, kind)}</dd>
        <dt className="font-semibold">{m.complaint_fact_reason()}</dt>
        <dd>{complaintReasonText(value.reason)}</dd>
        <dt className="font-semibold">{m.manage_decided_by()}</dt>
        <dd>
          {value.by === viewer
            ? m.manage_decided_by_you()
            : m.manage_decided_by_other({ id: value.by.slice(0, 8) })}{" "}
          · {formatDateTime(value.at)}
        </dd>
      </dl>
      <p className="mt-3 whitespace-pre-line leading-relaxed">{value.text}</p>
    </div>
  )
}

export default function ManageComplaint({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { complaint: c, stage, blocked, viewer, dueAt } = loaderData
  const failed =
    actionData && "errors" in actionData
      ? {
          decision: actionData.decision,
          errors: decideErrors(actionData.decision, actionData.errors),
        }
      : null
  const conflict = Boolean(actionData && "conflict" in actionData)
  const title = m.manage_complaint_title({ code: c.code })
  const pageTitle = useSiteTitle(title)
  const { issue, demand } = c
  const kind = demand ? "demand" : "issue"
  return (
    <div>
      <title>{errorTitle(pageTitle, Boolean(actionData))}</title>
      <ReviewNotices
        conflict={conflict}
        errors={failed?.errors ?? []}
        attempt={actionData}
      />
      {actionData && "sameAdmin" in actionData ? (
        <p
          role="alert"
          className="mb-8 border-4 border-danger p-5 font-semibold"
        >
          {m.manage_appeal_other_admin()}
        </p>
      ) : null}
      {actionData && "notAllowed" in actionData ? (
        <p
          role="alert"
          className="mb-8 border-4 border-danger p-5 font-semibold"
        >
          {m.manage_decide_not_allowed({
            action: DECISION_ACTION_TEXT[actionData.notAllowed](),
          })}
        </p>
      ) : null}
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={stage ? "brand" : "neutral"}>
          {COMPLAINT_STATUS_TEXT[c.status]()}
        </Badge>
        {c.status === "open" ? (
          <span className="font-ui text-ink-soft text-sm">
            {m.manage_complaint_due({ date: formatDate(dueAt) })}
          </span>
        ) : null}
      </p>

      <section aria-labelledby="isi-aduan" className={SECTION}>
        <h2 id="isi-aduan" className={H2}>
          {m.manage_complaint_content_title()}
        </h2>
        <dl className={DL}>
          <dt className="font-semibold">{m.complaint_fact_what()}</dt>
          <dd>{COMPLAINT_REASON_TEXT[c.reason]()}</dd>
          <dt className="font-semibold">{m.complaint_fact_part()}</dt>
          <dd>{complaintPartText(c.part, kind)}</dd>
          <dt className="font-semibold">{m.manage_col_received()}</dt>
          <dd>{formatDateTime(c.createdAt)}</dd>
        </dl>
        <p className="mt-4 whitespace-pre-line border-line-subtle border-l-4 pl-4 leading-relaxed">
          {c.explanation}
        </p>
        <p className="mt-3 font-ui text-ink-muted text-sm">
          {m.manage_complaint_identity_note()}
        </p>
      </section>

      {issue ? (
        <section aria-labelledby="isu-diadukan" className={SECTION}>
          <h2 id="isu-diadukan" className={H2}>
            {m.manage_complaint_issue_title()}
          </h2>
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <Link to={`/kelola/isu/${issue.code}`} className={LINK}>
              {issue.code}
            </Link>
            <Badge tone={issue.publishedAt ? "soft" : "neutral"}>
              {issue.takenDownAt
                ? m.manage_issue_taken_down()
                : issue.publishedAt
                  ? m.manage_issue_public()
                  : m.manage_issue_unpublished()}
            </Badge>
            {issue.redactedAt ? <Badge>{m.issue_redacted()}</Badge> : null}
          </p>
          <h3 className="mt-3 font-bold text-xl">{issue.title}</h3>
          <p className="mt-2 whitespace-pre-line leading-relaxed">
            {issue.summary}
          </p>
          {issue.publishedAt ? (
            <p className="mt-3">
              <Link to={`/isu/${issue.code}`} className={LINK}>
                {m.manage_view_public()}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
      {demand ? (
        <section aria-labelledby="tuntutan-diadukan" className={SECTION}>
          <h2 id="tuntutan-diadukan" className={H2}>
            {m.manage_complaint_demand_title()}
          </h2>
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <Link to={`/kelola/tuntutan/${demand.code}`} className={LINK}>
              {demand.code}
            </Link>
            <Badge tone={demand.state === "draft" ? "neutral" : "soft"}>
              {demand.hiddenAt
                ? m.manage_demand_hidden()
                : STATE_TEXT[demand.state]()}
            </Badge>
          </p>
          <h3 className="mt-3 font-bold text-xl">{demand.title}</h3>
          <p className="mt-2 whitespace-pre-line leading-relaxed">
            {demand.summary}
          </p>
          {demand.state !== "draft" ? (
            <p className="mt-3">
              <Link to={`/tuntutan/${demand.code}`} className={LINK}>
                {m.manage_view_public()}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        id="keputusan"
        aria-labelledby="keputusan-title"
        className={SECTION}
      >
        <h2 id="keputusan-title" className={H2}>
          {m.complaint_decision_title()}
        </h2>
        {c.first ? (
          <DecisionBlock
            title={m.complaint_first_decision()}
            value={c.first}
            viewer={viewer}
            kind={kind}
          />
        ) : (
          <p className="mt-3 text-ink-muted">
            {m.manage_complaint_undecided()}
          </p>
        )}
        {c.appeal ? (
          <div className="mt-6">
            <h3 className="font-bold text-lg">
              {m.manage_appeal_text_title()}
            </h3>
            <p className="mt-1 font-ui text-ink-muted text-sm">
              {formatDateTime(c.appeal.at)}
            </p>
            <p className="mt-2 whitespace-pre-line border-line-subtle border-l-4 pl-4 leading-relaxed">
              {c.appeal.text}
            </p>
          </div>
        ) : null}
        {c.appealDecision ? (
          <DecisionBlock
            title={m.complaint_appeal_decision()}
            value={c.appealDecision}
            viewer={viewer}
            kind={kind}
          />
        ) : null}
      </section>

      {stage ? (
        <section aria-labelledby="putuskan" className={SECTION}>
          <h2 id="putuskan" className={H2}>
            {stage === "appeal"
              ? m.manage_decide_appeal_title()
              : m.manage_decide_title()}
          </h2>
          <p className="mt-1 mb-5 font-ui text-[0.95rem] text-ink-soft">
            {m.manage_decide_lead()}
          </p>
          {blocked ? (
            <Note tone="info">{m.manage_appeal_other_admin()}</Note>
          ) : (
            <DecisionPanels
              failed={failed}
              target={{
                stage,
                subject: issue
                  ? {
                      kind: "issue",
                      version: issue.version,
                      title: issue.title,
                      summary: issue.summary,
                      published: issue.publishedAt !== null,
                      takenDown: issue.takenDownAt !== null,
                    }
                  : {
                      kind: "demand",
                      version: demand?.version ?? 0,
                      title: demand?.title ?? "",
                      summary: demand?.summary ?? "",
                      published: demand?.state !== "draft",
                      takenDown: false,
                    },
                evidence: c.evidence.map((file) => ({
                  id: file.id,
                  label: m.manage_withdraw_item({
                    kind: KIND_TEXT[file.kind](),
                    report: file.reportCode,
                    n: file.position + 1,
                  }),
                })),
              }}
            />
          )}
        </section>
      ) : null}

      {c.takedowns.length > 0 ? (
        <section aria-labelledby="penghapusan" className={SECTION}>
          <h2 id="penghapusan" className={H2}>
            {m.manage_takedowns_title()}
          </h2>
          <p className="mt-1 mb-4 font-ui text-[0.95rem] text-ink-soft">
            {m.manage_takedowns_lead()}
          </p>
          <Table caption={m.manage_takedowns_caption()}>
            <thead>
              <tr>
                <Th>{m.manage_col_change()}</Th>
                <Th>{m.manage_col_started()}</Th>
                <Th>{m.manage_col_purge()}</Th>
              </tr>
            </thead>
            <tbody>
              {c.takedowns.map((row) => (
                <tr key={row.id}>
                  <Td>{TAKEDOWN_TEXT[row.action]()}</Td>
                  <Td className="whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </Td>
                  <Td>
                    <Badge
                      tone={row.purgeStatus === "done" ? "success" : "neutral"}
                    >
                      {PURGE_TEXT[row.purgeStatus]()}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}
    </div>
  )
}
