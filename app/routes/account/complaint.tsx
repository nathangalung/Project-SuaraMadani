import { CircleCheck } from "lucide-react"
import { data, Form, Link, redirect } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button, ButtonLink } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Container } from "~/components/ui/container"
import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { Textarea } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import {
  appealComplaint,
  getOwnComplaint,
} from "~/features/issues/complaint.server"
import {
  COMPLAINT_REASON_TEXT,
  COMPLAINT_STATUS_TEXT,
  complaintOutcomeText,
  complaintPartText,
  complaintReasonText,
} from "~/features/moderation/complaint-labels"
import { useSubmitting } from "~/features/moderation/submitting"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import {
  COMPLAINT_LENGTHS,
  COMPLAINT_SLA_DAYS,
  type ComplaintDecision,
  type ComplaintDecisionReason,
  normalizeComplaintCode,
} from "../../../shared/complaints.ts"
import { formatDate, formatRange } from "../../../shared/format.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/complaint"

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeComplaintCode(params.code)
  if (!code) throw data(null, { status: 404 })
  if (code !== params.code) throw redirect(`/aduan/${code}`, 301)
  const session = context.get(sessionContext)
  if (!session) {
    throw redirect(`/masuk?kembali=${encodeURIComponent(`/aduan/${code}`)}`)
  }
  const complaint = await getOwnComplaint(
    tenant.id,
    code,
    session.user.id,
    new Date(),
  )
  // Not the complainant: 404
  if (!complaint) throw data(null, { status: 404 })
  const sent = new URL(request.url).searchParams.get("terkirim") === "1"
  return { complaint, sent }
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  const code = normalizeComplaintCode(params.code)
  if (!code || !session) throw data(null, { status: 404 })
  const form = await request.formData()
  const text = form.get("appeal")
  const result = await appealComplaint(tenant.id, {
    code,
    userId: session.user.id,
    text: typeof text === "string" ? text : "",
    now: new Date(),
  })
  if (result.ok) throw redirect(`/aduan/${code}#keputusan`, 303)
  if (result.reason === "not_found") throw data(null, { status: 404 })
  return data({ error: result.reason }, { status: 400 })
}

const A = COMPLAINT_LENGTHS.appeal

function subjectHref(subject: { kind: "issue" | "demand"; code: string }) {
  return `${subject.kind === "issue" ? "/isu" : "/tuntutan"}/${subject.code}`
}
const LINK =
  "font-semibold text-accent underline underline-offset-4 hover:no-underline"
const SECTION = "mt-10 border-ink border-t-2 pt-6"

type Decided = {
  decision: ComplaintDecision
  reason: ComplaintDecisionReason
  text: string
  decidedAt: Date
}

function Decision({
  title,
  value,
  kind,
}: {
  title: string
  value: Decided
  kind: "issue" | "demand"
}) {
  return (
    <div className="mt-5">
      <h3 className="font-bold text-lg">{title}</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold">{m.complaint_fact_outcome()}</dt>
        <dd>{complaintOutcomeText(value.decision, kind)}</dd>
        <dt className="font-semibold">{m.complaint_fact_reason()}</dt>
        <dd>{complaintReasonText(value.reason)}</dd>
        <dt className="font-semibold">{m.complaint_fact_date()}</dt>
        <dd>
          <time dateTime={value.decidedAt.toISOString()}>
            {formatDate(value.decidedAt)}
          </time>
        </dd>
      </dl>
      <p className="mt-3 whitespace-pre-line leading-relaxed">{value.text}</p>
    </div>
  )
}

// Receipt, decision and appeal
export default function ComplaintStatus({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { complaint: c, sent } = loaderData
  const title = m.complaint_status_title()
  const pageTitle = useSiteTitle(title)
  const pending = useSubmitting()
  const errors = actionData
    ? [
        {
          fieldId: "appeal",
          message:
            actionData.error === "length"
              ? m.error_complaint_appeal(formatRange(A))
              : m.error_complaint_appeal_closed(),
        },
      ]
    : []
  return (
    <div className="bg-page">
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <Container width="3xl" className="py-10 pb-24">
        <ErrorSummary errors={errors} attempt={actionData} />
        {sent ? (
          <Note tone="success" className="mb-8">
            <span role="status" className="flex items-start gap-2">
              <CircleCheck
                aria-hidden="true"
                className="confirm-in mt-0.5 size-5 shrink-0"
              />
              {m.complaint_sent_note()}
            </span>
          </Note>
        ) : null}
        <h1 className="font-bold font-heading text-[clamp(2rem,4.4vw,2.75rem)] text-ink leading-[1.1] [font-synthesis-weight:none]">
          {title}
        </h1>
        <p className="mt-4 flex flex-wrap items-center gap-2">
          <Badge className="tabular-nums">{c.code}</Badge>
          <Badge tone={c.status === "open" ? "neutral" : "soft"}>
            {COMPLAINT_STATUS_TEXT[c.status]()}
          </Badge>
        </p>
        <Card className="mt-6 p-5 sm:p-6">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
            <dt className="font-semibold">
              {c.subject.kind === "issue"
                ? m.complaint_fact_issue()
                : m.complaint_fact_demand()}
            </dt>
            <dd>
              {c.subject.published ? (
                <Link to={subjectHref(c.subject)} className={LINK}>
                  {c.subject.code}
                </Link>
              ) : (
                c.subject.code
              )}{" "}
              · {c.subject.title}
            </dd>
            <dt className="font-semibold">{m.complaint_fact_what()}</dt>
            <dd>{COMPLAINT_REASON_TEXT[c.reason]()}</dd>
            <dt className="font-semibold">{m.complaint_fact_part()}</dt>
            <dd>{complaintPartText(c.part, c.subject.kind)}</dd>
            <dt className="font-semibold">{m.complaint_fact_sent()}</dt>
            <dd>
              <time dateTime={c.createdAt.toISOString()}>
                {formatDate(c.createdAt)}
              </time>
            </dd>
          </dl>
          <p className="mt-4 whitespace-pre-line border-line-subtle border-t pt-4 text-ink-soft leading-relaxed">
            {c.explanation}
          </p>
        </Card>

        <section
          id="keputusan"
          aria-labelledby="decision-title"
          className={SECTION}
        >
          <h2 id="decision-title" className="font-bold text-2xl">
            {m.complaint_decision_title()}
          </h2>
          {c.decision ? (
            <Decision
              title={m.complaint_first_decision()}
              value={c.decision}
              kind={c.subject.kind}
            />
          ) : (
            <p className="mt-3 text-ink-soft">
              {m.complaint_waiting({ days: COMPLAINT_SLA_DAYS })}
            </p>
          )}
          {c.appeal ? (
            <div className="mt-6">
              <h3 className="font-bold text-lg">
                {m.complaint_appeal_yours()}
              </h3>
              <p className="mt-1 font-ui text-ink-muted text-sm">
                <time dateTime={c.appeal.appealedAt.toISOString()}>
                  {formatDate(c.appeal.appealedAt)}
                </time>
              </p>
              <p className="mt-2 whitespace-pre-line leading-relaxed">
                {c.appeal.text}
              </p>
            </div>
          ) : null}
          {c.appealDecision ? (
            <Decision
              title={m.complaint_appeal_decision()}
              value={c.appealDecision}
              kind={c.subject.kind}
            />
          ) : c.appeal ? (
            <p className="mt-4 text-ink-soft">{m.complaint_appeal_waiting()}</p>
          ) : null}
        </section>

        {c.canAppeal && c.appealUntil ? (
          <section aria-labelledby="appeal-title" className={SECTION}>
            <h2 id="appeal-title" className="font-bold text-2xl">
              {m.complaint_appeal_title()}
            </h2>
            <p className="mt-2 text-ink-soft">
              {m.complaint_appeal_lead({ date: formatDate(c.appealUntil) })}
            </p>
            <Form method="post" className="mt-5 flex flex-col gap-5">
              <Textarea
                id="appeal"
                name="appeal"
                label={m.complaint_appeal_label()}
                hint={m.complaint_appeal_hint(formatRange(A))}
                requiredMark
                error={errors[0]?.message}
                maxLength={A.max}
                rows={5}
              />
              <div>
                <Button type="submit" variant="dark" pending={pending}>
                  {m.complaint_appeal_submit()}
                </Button>
              </div>
            </Form>
          </section>
        ) : null}

        <p className="mt-12">
          <ButtonLink
            to={
              c.subject.published
                ? subjectHref(c.subject)
                : c.subject.kind === "issue"
                  ? "/isu"
                  : "/tuntutan"
            }
            variant="secondary"
          >
            {c.subject.published
              ? c.subject.kind === "issue"
                ? m.complaint_back()
                : m.complaint_back_demand()
              : c.subject.kind === "issue"
                ? m.nav_issues()
                : m.explore_tab_demands()}
          </ButtonLink>
        </p>
      </Container>
    </div>
  )
}
