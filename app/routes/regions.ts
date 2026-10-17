import { data } from "react-router"
import { childrenOf, parseRegionFile } from "~/features/report/regions.server"
import type { Route } from "./+types/regions"

// Region lists cache 86400 s
const CACHE = {
  "Cache-Control": "public, max-age=0, no-transform",
  "Cloudflare-CDN-Cache-Control":
    "max-age=86400, stale-while-revalidate=30, stale-if-error=86400",
}

export async function loader({ params }: Route.LoaderArgs) {
  const parent = parseRegionFile(params.file)
  const children = parent ? await childrenOf(parent) : null
  if (!children) throw data(null, { status: 404 })
  return Response.json(children, { headers: CACHE })
}
