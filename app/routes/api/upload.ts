import { receiveUpload } from "../../../server/api/upload.server.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/upload"

export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } })
  }
  return receiveUpload({
    request,
    evidenceId: params.evidenceId,
    tenant: context.get(tenantContext),
    session: context.get(sessionContext),
  })
}
