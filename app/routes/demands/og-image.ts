import { data } from "react-router"
import { getDemandCard } from "~/features/demands/demands.server"
import { FULFILMENT_TEXT, SCOPE_TEXT } from "~/features/demands/labels"
import { renderOgPng } from "~/features/issues/og-image.server"
import { m } from "~/paraglide/messages.js"
import { normalizeDemandCode } from "../../../shared/demands.ts"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/og-image"

// Starting Values: OG image
const IMMUTABLE = "max-age=31536000, immutable"

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeDemandCode(params.code)
  const demand = code ? await getDemandCard(tenant.id, code) : null
  if (!code || !demand) throw data(null, { status: 404 })
  // Other queries redirect, no render
  const version = String(demand.version)
  if (new URL(request.url).search !== `?v=${version}`) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `/tuntutan/${code}/og.png?v=${version}`,
        "Cache-Control": "no-store",
      },
    })
  }
  const png = await renderOgPng({
    code,
    title: demand.title,
    place: demand.provinceName ?? "",
    // Footer keeps the region only
    detail: [
      SCOPE_TEXT[demand.scope](),
      m.demand_progress_line({
        done: demand.progress.fulfilled,
        total: demand.progress.total,
      }),
    ].join(", "),
    label: FULFILMENT_TEXT[demand.progress.status](),
    siteName: m.og_site_name({ name: tenant.name }),
  })
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, ${IMMUTABLE}`,
      "Cloudflare-CDN-Cache-Control": IMMUTABLE,
    },
  })
}
