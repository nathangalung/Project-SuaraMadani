import { MailCheck, UserRound } from "lucide-react"
import type { CSSProperties } from "react"
import { Form } from "react-router"
import { useStagger } from "~/components/layout/use-reveal"
import { Button } from "~/components/ui/button"
import { Checkbox, TextInput } from "~/components/ui/field"
import { Note } from "~/components/ui/note"
import { ActionPanel } from "~/features/moderation/action-panel"
import { useSubmitting } from "~/features/moderation/submitting"
import { m } from "~/paraglide/messages.js"
import { formatDate } from "../../../shared/format.ts"
import type { PendingInvitation, StaffMember } from "./members.server"
import type { TeamOutcome } from "./team-actions.server"

const H2 = "font-bold text-2xl"

const NOTICE: Record<TeamOutcome, (p: { email: string }) => string> = {
  invited: m.team_notice_invited,
  invited_unsent: m.team_notice_invited_unsent,
  invited_limited: m.team_notice_invited_limited,
  resent: m.team_notice_resent,
  resent_unsent: m.team_notice_resent_unsent,
  resent_limited: m.team_notice_resent_limited,
  canceled: m.team_notice_canceled,
  removed: m.team_notice_removed,
  staff: m.team_notice_staff,
  pending: m.team_notice_pending,
  not_found: m.team_notice_not_found,
  last_admin: m.team_notice_last_admin,
  self: m.team_notice_self,
  unconfirmed: m.team_notice_unconfirmed,
}

const DONE: ReadonlySet<TeamOutcome> = new Set([
  "invited",
  "resent",
  "canceled",
  "removed",
])

/** Outcome of the last form. */
export function TeamNotice({
  notice,
  email,
}: {
  notice: TeamOutcome
  email?: string
}) {
  return (
    <div role="status" className="confirm-in mb-8">
      <Note tone={DONE.has(notice) ? "success" : "danger"}>
        {NOTICE[notice]({ email: email ?? "" })}
      </Note>
    </div>
  )
}

export function InviteForm({
  errors,
  values,
}: {
  errors: { email?: string }
  values: { email: string }
}) {
  const pending = useSubmitting("invite")
  return (
    <Form
      method="post"
      className="flex flex-col gap-6 border border-line-subtle bg-surface-raised p-5 sm:p-6"
    >
      <input type="hidden" name="intent" value="invite" />
      <TextInput
        id="invite-email"
        name="email"
        type="email"
        autoComplete="off"
        label={m.team_invite_email()}
        hint={m.team_invite_email_hint()}
        error={errors.email}
        defaultValue={values.email}
        requiredMark
      />
      <Note>{m.team_invite_role_note()}</Note>
      <div>
        <Button type="submit" pending={pending}>
          <MailCheck aria-hidden="true" className="size-5" />
          {m.team_invite_submit()}
        </Button>
      </div>
    </Form>
  )
}

function MemberRow({
  member,
  self,
  index,
}: {
  member: StaffMember
  self: boolean
  index: number
}) {
  const removing = useSubmitting("remove")
  return (
    <li
      style={{ "--i": index } as CSSProperties}
      className="border-line-subtle border-b py-4"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center bg-brand-soft text-accent"
        >
          <UserRound className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="font-semibold [overflow-wrap:anywhere]">
              {member.email}
              {self ? (
                <span className="font-normal text-ink-muted">
                  {" "}
                  {m.team_you()}
                </span>
              ) : null}
            </p>
            <p className="text-ink-muted text-sm">
              {m.team_joined({ date: formatDate(member.joinedAt) })}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-3">
        {self ? (
          <p className="text-ink-muted text-sm">{m.team_self_note()}</p>
        ) : (
          <ActionPanel
            id={`remove-${member.userId}`}
            title={m.team_remove()}
            tone="danger"
          >
            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="remove" />
              <input type="hidden" name="user" value={member.userId} />
              <p className="text-ink-soft text-sm leading-relaxed">
                {m.team_remove_effect()}
              </p>
              <Checkbox
                id={`remove-confirm-${member.userId}`}
                name="confirm"
                value="yes"
                required
                label={m.team_remove_confirm()}
              />
              <div>
                <Button type="submit" variant="danger" pending={removing}>
                  {m.team_remove()}
                </Button>
              </div>
            </Form>
          </ActionPanel>
        )}
      </div>
    </li>
  )
}

export function MemberList({
  members,
  selfId,
}: {
  members: StaffMember[]
  selfId: string
}) {
  const list = useStagger<HTMLUListElement>()
  return (
    <section aria-labelledby="anggota-tim" className="mt-12">
      <h2 id="anggota-tim" className={H2}>
        {m.team_members_title()}
      </h2>
      <ul ref={list} className="mt-4 border-ink border-t-2">
        {members.map((member, i) => (
          <MemberRow
            key={member.userId}
            member={member}
            self={member.userId === selfId}
            index={i}
          />
        ))}
      </ul>
    </section>
  )
}

export function InvitationList({
  invitations,
}: {
  invitations: PendingInvitation[]
}) {
  const resending = useSubmitting("resend")
  const canceling = useSubmitting("cancel")
  if (invitations.length === 0) return null
  return (
    <section aria-labelledby="undangan-tertunda" className="mt-12">
      <h2 id="undangan-tertunda" className={H2}>
        {m.team_invitations_title()}
      </h2>
      <ul className="mt-4 border-ink border-t-2">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-3 border-line-subtle border-b py-4"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold [overflow-wrap:anywhere]">
                {invitation.email}
              </p>
              <p className="text-ink-muted text-sm">
                {invitation.expired
                  ? m.team_invitation_expired()
                  : m.team_invitation_until({
                      date: formatDate(invitation.expiresAt),
                    })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Form method="post">
                <input type="hidden" name="intent" value="resend" />
                <input type="hidden" name="invitation" value={invitation.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  pending={resending}
                >
                  {m.team_invitation_resend()}
                </Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="cancel" />
                <input type="hidden" name="invitation" value={invitation.id} />
                <Button
                  type="submit"
                  size="sm"
                  variant="quiet"
                  pending={canceling}
                >
                  {m.team_invitation_cancel()}
                </Button>
              </Form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
