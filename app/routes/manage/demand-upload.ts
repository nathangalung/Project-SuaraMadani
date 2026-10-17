import { data, redirect } from "react-router"
import { uploadBrief } from "~/features/demands/manage.server"
import { requireAdmin } from "~/features/moderation/access.server"
import {
  BRIEF_MAX_BYTES,
  normalizeDemandCode,
} from "../../../shared/demands.ts"
import type { Route } from "./+types/demand-upload"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Multipart, own body limit
export async function action({ request, params, context }: Route.ActionArgs) {
  const { tenant, session } = await requireAdmin(context)
  const code = normalizeDemandCode(params.code)
  if (!code) throw data(null, { status: 404 })
  const back = (result: string, itemId: string) =>
    redirect(
      `/kelola/tuntutan/${code}?dokumen=${result}&butir=${itemId}#sub-${itemId}`,
      303,
    )
  const form = await request.formData()
  const itemId = String(form.get("itemId") ?? "")
  const file = form.get("brief")
  if (!UUID.test(itemId)) throw data(null, { status: 400 })
  if (!(file instanceof File) || file.size === 0) throw back("kosong", itemId)
  if (file.size > BRIEF_MAX_BYTES) throw back("besar", itemId)
  const result = await uploadBrief(
    { id: tenant.id, host: tenant.host, campusCode: tenant.campusCode },
    {
      code,
      itemId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actorId: session.user.id,
    },
  )
  if (result.ok) throw back("diunggah", itemId)
  if (result.reason === "not_found") throw data(null, { status: 404 })
  if (result.reason === "closed") throw back("ditutup", itemId)
  throw back(result.reason === "too_large" ? "besar" : "bukan-pdf", itemId)
}
