import { data, type RouterContextProvider } from "react-router"
import { parseEmail } from "../../../shared/campus.ts"
import { requireAdmin } from "../moderation/access.server.ts"
import { requireFresh } from "../moderation/step-up.server.ts"
import {
  cancelInvitation,
  type InvitationMail,
  inviteMember,
  removeMember,
  resendInvitation,
} from "./members.server.ts"

export type TeamOutcome =
  | "invited"
  | "invited_unsent"
  | "invited_limited"
  | "resent"
  | "resent_unsent"
  | "resent_limited"
  | "canceled"
  | "removed"
  | "staff"
  | "pending"
  | "not_found"
  | "last_admin"
  | "self"
  | "unconfirmed"

const INVITED = {
  sent: "invited",
  failed: "invited_unsent",
  limited: "invited_limited",
} as const satisfies Record<InvitationMail, TeamOutcome>

const RESENT = {
  sent: "resent",
  failed: "resent_unsent",
  limited: "resent_limited",
} as const satisfies Record<InvitationMail, TeamOutcome>

export type InviteError = "invite_email"

export type TeamActionData =
  | { notice: TeamOutcome; email?: string }
  | { errors: InviteError[]; values: { email: string } }

const text = (form: FormData, key: string) => String(form.get(key) ?? "")

/** One form per intent. */
export async function teamAction({
  request,
  context,
}: {
  request: Request
  context: Readonly<RouterContextProvider>
}): Promise<TeamActionData | Response> {
  const { tenant, session } = await requireAdmin(context)
  await requireFresh(context, request)
  const actorId = session.user.id
  const form = await request.formData()
  const intent = text(form, "intent")

  if (intent === "invite") {
    const values = { email: text(form, "email") }
    const email = parseEmail(values.email)
    if (!email) return { errors: ["invite_email"], values }
    const result = await inviteMember({ tenant, actorId, email })
    if (!result.ok) {
      if (result.reason === "forbidden") throw data(null, { status: 403 })
      if (result.reason === "email") return { errors: ["invite_email"], values }
      return { notice: result.reason, email }
    }
    return {
      notice: INVITED[result.mail],
      email,
    }
  }

  if (intent === "resend" || intent === "cancel") {
    const input = { tenant, actorId, invitationId: text(form, "invitation") }
    if (intent === "cancel") {
      const result = await cancelInvitation(input)
      return { notice: result.ok ? "canceled" : result.reason }
    }
    const result = await resendInvitation(input)
    if (!result.ok) return { notice: result.reason }
    return { notice: RESENT[result.mail] }
  }

  if (intent === "remove") {
    // Checkbox is required client-side too
    if (form.get("confirm") !== "yes") return { notice: "unconfirmed" }
    const userId = text(form, "user")
    const result = await removeMember({ tenant, actorId, userId })
    if (!result.ok) {
      if (result.reason === "forbidden") throw data(null, { status: 403 })
      return { notice: result.reason }
    }
    return { notice: "removed" }
  }
  throw data(null, { status: 400 })
}
