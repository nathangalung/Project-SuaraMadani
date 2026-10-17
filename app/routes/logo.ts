import { data } from "react-router"
import { readLogo } from "~/features/campus/settings.server"
import { tenantContext } from "../context.ts"
import type { Route } from "./+types/logo"

// Hashed name never changes
const IMMUTABLE = "max-age=31536000, immutable"

export async function loader({ params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const bytes = await readLogo(tenant.id, params.file)
  if (!bytes) throw data(null, { status: 404 })
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": `public, ${IMMUTABLE}`,
      "Cloudflare-CDN-Cache-Control": IMMUTABLE,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
}
