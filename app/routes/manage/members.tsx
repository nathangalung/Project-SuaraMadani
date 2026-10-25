import { ErrorSummary, errorTitle } from "~/components/ui/error-summary"
import { listTeam } from "~/features/campus/members.server"
import {
  InvitationList,
  InviteForm,
  MemberList,
  TeamNotice,
} from "~/features/campus/team"
import {
  type InviteError,
  teamAction,
} from "~/features/campus/team-actions.server"
import { requireAdmin } from "~/features/moderation/access.server"
import { requireFresh } from "~/features/moderation/step-up.server"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import type { Route } from "./+types/members"

export async function loader({ context, request }: Route.LoaderArgs) {
  const { tenant, session } = await requireAdmin(context)
  // Window starts at page load
  await requireFresh(context, request)
  const team = await listTeam(tenant.id, new Date())
  return { ...team, selfId: session.user.id, operator: tenant.name }
}

export const action = teamAction

const FIELD: Record<InviteError, string> = { invite_email: "invite-email" }
const ERROR: Record<InviteError, () => string> = {
  invite_email: m.error_email_format,
}

export default function Members({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const title = m.team_title()
  const pageTitle = useSiteTitle(title)
  const keys = actionData && "errors" in actionData ? actionData.errors : []
  const errors = keys.map((key) => ({
    fieldId: FIELD[key],
    message: ERROR[key](),
  }))
  const values =
    actionData && "values" in actionData ? actionData.values : { email: "" }
  const notice = actionData && "notice" in actionData ? actionData : null
  // Sent invite clears form
  const formKey = notice?.notice === "invited" ? notice.email : "invite"
  return (
    <div>
      <title>{errorTitle(pageTitle, errors.length > 0)}</title>
      <ErrorSummary errors={errors} attempt={actionData} />
      {notice ? (
        <TeamNotice notice={notice.notice} email={notice.email} />
      ) : null}
      <h1 className="font-bold font-heading text-3xl [font-synthesis-weight:none]">
        {title}
      </h1>
      <p className="mt-2 text-ink-muted">
        {m.team_lead({ operator: loaderData.operator })}
      </p>
      <section aria-labelledby="undang-anggota" className="mt-10">
        <h2 id="undang-anggota" className="mb-4 font-bold text-2xl">
          {m.team_invite_title()}
        </h2>
        <InviteForm
          key={formKey}
          values={values}
          errors={{
            email: errors.find((e) => e.fieldId === FIELD.invite_email)
              ?.message,
          }}
        />
      </section>
      <MemberList members={loaderData.members} selfId={loaderData.selfId} />
      <InvitationList invitations={loaderData.invitations} />
    </div>
  )
}
