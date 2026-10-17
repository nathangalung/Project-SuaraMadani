import { data } from "react-router"
import { requireAdmin } from "~/features/moderation/access.server"
import {
  previewResponse,
  readPreview,
} from "~/features/moderation/evidence.server"
import type { Route } from "./+types/evidence"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Previews only, never originals
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { tenant, role } = await requireAdmin(context)
  const file = UUID.test(params.id)
    ? await readPreview(tenant.id, role, params.id, undefined, params.file)
    : null
  if (!file) throw data(null, { status: 404 })
  return previewResponse(request, file, params.file)
}
