import { data } from "react-router"
import { requireAdmin } from "~/features/moderation/access.server"
import {
  originalResponse,
  readOriginal,
} from "~/features/moderation/evidence.server"
import type { Route } from "./+types/evidence-original"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Download only, unmodified, audited
export async function loader({ params, context }: Route.LoaderArgs) {
  const { tenant, role, session } = await requireAdmin(context)
  const found = UUID.test(params.id)
    ? await readOriginal(tenant.id, {
        role,
        actorId: session.user.id,
        evidenceId: params.id,
      })
    : null
  if (!found) throw data(null, { status: 404 })
  return originalResponse(found.file, found.name)
}
