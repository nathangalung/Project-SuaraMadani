import { data } from "react-router"
import { requireAdmin } from "~/features/moderation/access.server"
import { readOriginal } from "~/features/moderation/evidence.server"
import type { Route } from "./+types/evidence-original"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** RFC 6266, ASCII plus UTF-8. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_").slice(0, 120)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

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
  return new Response(found.file, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": disposition(found.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
}
