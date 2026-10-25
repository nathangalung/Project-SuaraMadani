import { receiveUpload } from "../../../server/api/upload.server.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import type { Route } from "./+types/upload"

// Server module picks the method
function receive({
  request,
  params,
  context,
}: Pick<Route.LoaderArgs, "request" | "params" | "context">) {
  return receiveUpload({
    request,
    evidenceId: params.evidenceId,
    tenant: context.get(tenantContext),
    session: context.get(sessionContext),
  })
}

/** tus HEAD, GET gets 405. */
export async function loader(args: Route.LoaderArgs) {
  return receive(args)
}

/** POST, tus PATCH and OPTIONS. */
export async function action(args: Route.ActionArgs) {
  return receive(args)
}
