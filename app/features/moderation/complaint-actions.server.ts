import { data, type RouterContextProvider, redirect } from "react-router"
import type { ComplaintDecision } from "../../../shared/complaints.ts"
import { requireAdmin } from "./access.server.ts"
import { decideComplaint, getComplaint } from "./complaints.server.ts"
import { parseDecideForm } from "./decide-form.ts"
import type { DecideErrorKey } from "./fields.ts"

export type DecideActionData =
  | { conflict: true }
  | { sameAdmin: true }
  | { notAllowed: ComplaintDecision }
  | { errors: DecideErrorKey[]; decision: ComplaintDecision }

type Args = {
  request: Request
  context: Readonly<RouterContextProvider>
  params: { code?: string }
}

export async function complaintPageAction({ request, context, params }: Args) {
  const { tenant, session, role } = await requireAdmin(context)
  const complaint = await getComplaint(tenant.id, role, params.code ?? "")
  if (!complaint) throw data(null, { status: 404 })
  const parsed = parseDecideForm(await request.formData())
  if (!parsed) throw data(null, { status: 400 })
  if ("errors" in parsed) {
    return data<DecideActionData>(parsed, { status: 400 })
  }
  const result = await decideComplaint(
    { id: tenant.id, host: tenant.host },
    {
      ...parsed.input,
      complaintId: complaint.id,
      actorId: session.user.id,
    },
  )
  if (result.ok)
    throw redirect(`/kelola/aduan/${complaint.code}#keputusan`, 303)
  if (result.reason === "not_found") throw data(null, { status: 404 })
  if (result.reason === "same_admin") {
    return data<DecideActionData>({ sameAdmin: true }, { status: 403 })
  }
  if (result.reason === "not_allowed") {
    return data<DecideActionData>(
      { notAllowed: parsed.input.decision },
      { status: 400 },
    )
  }
  return data<DecideActionData>({ conflict: true }, { status: 409 })
}
