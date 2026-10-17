import { data } from "react-router"
import { normalizeIssueCode } from "~/features/issues/issue-code"
import { getPublishedIssue } from "~/features/issues/issues.server"
import { VERIFICATION_TEXT } from "~/features/issues/labels"
import { renderOgPng } from "~/features/issues/og-image.server"
import { m } from "~/paraglide/messages.js"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/og-image"

// Starting Values: OG image
const IMMUTABLE = "max-age=31536000, immutable"

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeIssueCode(params.code)
  const issue = code ? await getPublishedIssue(tenant.id, code) : null
  if (!code || !issue) throw data(null, { status: 404 })
  // Other queries redirect, no render
  const version = String(issue.version)
  if (new URL(request.url).search !== `?v=${version}`) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `/isu/${code}/og.png?v=${version}`,
        "Cache-Control": "no-store",
      },
    })
  }
  const png = await renderOgPng({
    code,
    title: issue.title,
    place: issue.districtName
      ? `${issue.districtName}, ${issue.regencyName}`
      : issue.regencyName,
    label: VERIFICATION_TEXT[issue.verificationLabel](),
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
