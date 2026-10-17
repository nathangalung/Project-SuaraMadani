import { data, type RouterContextProvider } from "react-router"
import { apexHost } from "../../../server/origin.server.ts"
import { type CampusField, parseCampusForm } from "../../../shared/campus.ts"
import { requireFresh } from "../moderation/step-up.server.ts"
import {
  createCampus,
  requireSuperadmin,
  resendFirstInvitation,
} from "./campuses.server.ts"
import type { InvitationMail } from "./members.server.ts"

export type CampusValues = Record<CampusField, string>

export type CampusActionData =
  | { created: { host: string; campusName: string; mail: InvitationMail } }
  | { errors: CampusField[]; values: CampusValues; taken?: boolean }
  | { resent: InvitationMail | "not_found" }

const FIELDS: CampusField[] = [
  "campusName",
  "name",
  "slug",
  "campusCode",
  "adminEmail",
  "contactEmail",
]

/** Superadmin creates one campus. */
export async function campusAction({
  request,
  context,
}: {
  request: Request
  context: Readonly<RouterContextProvider>
}): Promise<CampusActionData> {
  const { session } = requireSuperadmin(context)
  await requireFresh(context, request)
  const form = await request.formData()
  if (form.get("intent") === "resend") {
    const result = await resendFirstInvitation({
      actorId: session.user.id,
      orgId: String(form.get("org") ?? ""),
    })
    if (result.ok) return { resent: result.mail }
    if (result.reason === "forbidden") throw data(null, { status: 403 })
    return { resent: result.reason }
  }
  const values = Object.fromEntries(
    FIELDS.map((field) => [field, String(form.get(field) ?? "")]),
  ) as CampusValues
  const parsed = parseCampusForm(values)
  if (!parsed.ok) return { errors: parsed.errors, values }
  const result = await createCampus({
    actorId: session.user.id,
    value: parsed.value,
    apexHost: apexHost(),
  })
  if (result.ok) {
    return {
      created: {
        host: result.host,
        campusName: parsed.value.campusName,
        mail: result.mail,
      },
    }
  }
  // Gate passed, flag since revoked
  if (result.reason === "forbidden") {
    throw data(null, { status: 403 })
  }
  return { errors: [result.field], values, taken: true }
}

// Shown beside the subdomain field
export { apexHost }
