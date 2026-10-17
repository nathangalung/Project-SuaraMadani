import { UserPlus } from "lucide-react"
import { data, Form, redirect } from "react-router"
import { AUTH_TITLE, AuthCard } from "~/components/layout/auth-card"
import { Button, ButtonLink } from "~/components/ui/button"
import { Note } from "~/components/ui/note"
import {
  acceptInvitation,
  readInvitation,
} from "~/features/campus/members.server"
import { useSubmitting } from "~/features/moderation/submitting"
import { useSiteTitle } from "~/features/report/page-title"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import { accountLabel } from "../../../shared/phone.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/invitation"

// Logo-only header, task focus
export const handle = { shell: "auth" }

export function headers() {
  return { "Cache-Control": "private, no-store" }
}

type View =
  | "sign_in"
  | "accept"
  | "other_email"
  | "unverified"
  | "expired"
  | "used"
  | "closed"

export async function loader({ params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  const invitation = await readInvitation(tenant.id, params.id)
  if (!invitation) throw data(null, { status: 404 })
  const now = Date.now()
  const view: View =
    invitation.status === "accepted"
      ? "used"
      : invitation.status === "canceled"
        ? "closed"
        : invitation.expiresAt.getTime() <= now
          ? "expired"
          : !session
            ? "sign_in"
            : session.user.email.toLowerCase() !== invitation.email
              ? "other_email"
              : session.user.emailVerified
                ? "accept"
                : "unverified"
  return {
    view,
    id: params.id,
    operator: tenant.name,
    expiresAt: invitation.expiresAt,
    // Only its owner sees it
    email: view === "accept" ? invitation.email : null,
    signedInAs: session ? accountLabel(session.user) : null,
  }
}

export async function action({ params, context }: Route.ActionArgs) {
  const tenant = context.get(tenantContext)
  const session = context.get(sessionContext)
  if (!session) throw redirect(`/masuk?kembali=/undangan/${params.id}`, 303)
  const result = await acceptInvitation({
    tenant,
    invitationId: params.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    },
    now: new Date(),
  })
  // Enrol TOTP, or straight in
  if (result.ok) throw redirect("/masuk/dua-langkah", 303)
  return { refused: result.reason }
}

const VIEW_BODY: Record<Exclude<View, "accept" | "sign_in">, () => string> = {
  other_email: m.invite_page_other_email,
  unverified: m.invite_page_unverified,
  expired: m.invite_page_expired,
  used: m.invite_page_used,
  closed: m.invite_page_closed,
}

export default function Invitation({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { view, operator, id } = loaderData
  const title = m.invite_page_title({ operator })
  const pending = useSubmitting()
  const refused = actionData?.refused
  return (
    <AuthCard>
      <title>{useSiteTitle(title)}</title>
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center bg-brand text-on-accent"
      >
        <UserPlus className="size-6" />
      </span>
      <h1 className={`mt-4 ${AUTH_TITLE}`}>{title}</h1>
      <p className="mt-2 text-ink-muted leading-relaxed">
        {m.invite_page_role()}
      </p>
      {view === "sign_in" ? (
        <>
          <p className="mt-4 leading-relaxed">{m.invite_page_sign_in()}</p>
          <div className="mt-6">
            <ButtonLink
              to={`/masuk?kembali=/undangan/${id}`}
              className="w-full"
            >
              {m.invite_page_sign_in_action()}
            </ButtonLink>
          </div>
        </>
      ) : view === "accept" ? (
        <>
          {refused ? (
            <Note tone="danger" className="mt-4">
              {m.invite_page_refused()}
            </Note>
          ) : null}
          <p className="mt-4 leading-relaxed">
            {m.invite_page_accept_body({
              email: loaderData.email ?? "",
              date: formatDate(loaderData.expiresAt),
            })}
          </p>
          <Form method="post" className="mt-6">
            <Button type="submit" pending={pending} className="w-full">
              {m.invite_page_accept()}
            </Button>
          </Form>
        </>
      ) : (
        <>
          <Note tone={view === "used" ? "info" : "danger"} className="mt-4">
            {VIEW_BODY[view]()}
          </Note>
          {view === "other_email" || view === "unverified" ? (
            <Form method="post" action="/keluar" className="mt-6">
              <input type="hidden" name="next" value="/masuk" />
              <Button type="submit" variant="secondary" className="w-full">
                {m.invite_page_switch({ email: loaderData.signedInAs ?? "" })}
              </Button>
            </Form>
          ) : view === "used" ? (
            <div className="mt-6">
              <ButtonLink to="/kelola" className="w-full">
                {m.invite_page_open_manage()}
              </ButtonLink>
            </div>
          ) : null}
        </>
      )}
    </AuthCard>
  )
}
