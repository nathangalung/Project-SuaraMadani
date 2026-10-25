import { data, Form, Link } from "react-router"
import { Button, ButtonLink } from "~/components/ui/button"
import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { Checkbox, Fieldset, Radio } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { requireAdmin } from "~/features/moderation/access.server"
import type { CloseErrorKey } from "~/features/moderation/fields"
import { CLOSE_REASON_TEXT } from "~/features/moderation/labels"
import {
  closeImpact,
  getReviewReport,
} from "~/features/moderation/queue.server"
import { closeAccountAction } from "~/features/moderation/review-actions.server"
import { useSubmitting } from "~/features/moderation/submitting"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { CLOSE_ACCOUNT_REASONS } from "../../../shared/moderation.ts"
import type { Route } from "./+types/close-account"

export async function loader({ params, context }: Route.LoaderArgs) {
  const { tenant, role, session } = await requireAdmin(context)
  const report = await getReviewReport(tenant.id, role, params.code)
  if (!report) throw data(null, { status: 404 })
  const impact = await closeImpact(tenant.id, role, report.id, session.user.id)
  // Staff accounts are never closed
  if (impact.staff) throw data(null, { status: 403 })
  return { code: report.code, impact }
}

export const action = closeAccountAction

const FIELD: Record<CloseErrorKey, string> = {
  close_reason: `close-${CLOSE_ACCOUNT_REASONS[0]}`,
  close_confirm: "close-confirm",
}
const ERROR: Record<CloseErrorKey, () => string> = {
  close_reason: m.error_close_reason,
  close_confirm: m.error_close_confirm,
}
const LINK = "font-semibold text-accent underline underline-offset-4"

export default function CloseAccount({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { code, impact } = loaderData
  const keys = actionData && "errors" in actionData ? actionData.errors : []
  const errors = keys.map((key) => ({
    fieldId: FIELD[key],
    message: ERROR[key](),
  }))
  const done = actionData && "done" in actionData ? actionData.done : null
  const title = done ? m.manage_close_done_title() : m.manage_close_title()
  const pageTitle = useSiteTitle(title)
  const pending = useSubmitting()
  if (done) {
    return (
      <div>
        <title>{pageTitle}</title>
        <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
          {title}
        </h1>
        <p role="status" className="mt-3">
          {m.manage_close_done_body({ count: done.reports })}
        </p>
        {done.issues.length > 0 ? (
          <>
            <p className="mt-6">{m.manage_close_done_issues()}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {done.issues.map((issue) => (
                <li key={issue}>
                  <Link to={`/kelola/isu/${issue}`} className={LINK}>
                    {issue}
                  </Link>
                  {done.unpublished.includes(issue)
                    ? `, ${m.manage_close_done_unpublished()}`
                    : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <Note tone="info" className="mt-6">
          {m.manage_close_effect_dpo()}
        </Note>
        <p className="mt-10">
          <ButtonLink to="/kelola/antrean">{m.manage_open_queue()}</ButtonLink>
        </p>
      </div>
    )
  }
  const error = (key: CloseErrorKey) =>
    errors.find((e) => e.fieldId === FIELD[key])?.message
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={actionData} />
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-3">{m.manage_close_lead({ code })}</p>
      <section aria-labelledby="close-effects" className="mt-8">
        <h2 id="close-effects" className="font-bold text-2xl">
          {m.manage_close_effects_title()}
        </h2>
        <ul className="mt-3 border-ink border-t-2">
          {[
            m.manage_close_effect_reports({ count: impact.reports }),
            m.manage_close_effect_issues({ count: impact.issues }),
            m.manage_close_effect_sessions(),
            m.manage_close_effect_dpo(),
          ].map((line) => (
            <li key={line} className="border-line-subtle border-b py-3">
              {line}
            </li>
          ))}
        </ul>
      </section>
      <Form method="post" className="mt-8 flex flex-col gap-6">
        <Fieldset
          id="close-reason"
          legend={m.manage_close_reason_legend()}
          error={error("close_reason")}
        >
          {CLOSE_ACCOUNT_REASONS.map((reason) => (
            <Radio
              key={reason}
              id={`close-${reason}`}
              name="reason"
              value={reason}
              label={CLOSE_REASON_TEXT[reason]()}
            />
          ))}
        </Fieldset>
        <Fieldset
          id="close-confirm-group"
          legend={m.manage_close_confirm_legend()}
          error={error("close_confirm")}
        >
          <Checkbox
            id="close-confirm"
            name="confirm"
            value="yes"
            label={m.manage_close_confirm()}
          />
        </Fieldset>
        <div>
          <Button type="submit" variant="danger" pending={pending}>
            {m.manage_close_submit()}
          </Button>
        </div>
      </Form>
    </div>
  )
}
