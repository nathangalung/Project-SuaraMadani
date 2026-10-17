import { data } from "react-router"
import { publicBriefFile } from "~/features/demands/demands.server"
import { normalizeDemandCode } from "../../../shared/demands.ts"
import { tenantContext } from "../../context.ts"
import type { Route } from "./+types/brief"

const FILE = /^([0-9a-f-]{36})\.pdf$/

// Scanned staff PDF, download
export async function loader({ params, context }: Route.LoaderArgs) {
  const tenant = context.get(tenantContext)
  const code = normalizeDemandCode(params.code)
  const id = FILE.exec(params.file)?.[1]
  const found = code && id ? await publicBriefFile(tenant.id, code, id) : null
  if (!code || !found) throw data(null, { status: 404 })
  const name = `${code}-sub-${found.itemNumber}-policy-brief.pdf`
  return new Response(found.file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(found.file.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
}
