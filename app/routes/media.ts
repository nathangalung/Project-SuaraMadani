import { data } from "react-router"
import { publicMediaResponse } from "~/features/issues/public-evidence.server"
import { tenantContext } from "../context.ts"
import type { Route } from "./+types/media"

// Caddy serves this in production
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const response = await publicMediaResponse(request, tenant.host, params.file)
  if (!response) throw data(null, { status: 404 })
  return response
}
