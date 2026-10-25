import { data } from "react-router"
import { provinceAt } from "~/features/report/province-at.server"
import { pointSchema } from "../../shared/report-schema.ts"
import type { Route } from "./+types/region-point"

// POST: no point in logs
export async function action({ request }: Route.ActionArgs) {
  const body: unknown = await request.json().catch(() => null)
  const point = pointSchema.safeParse(body)
  if (!point.success) throw data(null, { status: 400 })
  return Response.json(
    { provinceCode: provinceAt(point.data) },
    { headers: { "Cache-Control": "no-store" } },
  )
}
