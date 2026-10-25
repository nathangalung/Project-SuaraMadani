import { redirect } from "react-router"
import { requestScope } from "../../../db/request-scope.ts"
import { getAuth } from "../../../server/auth.server.ts"
import {
  type LogRecord,
  securityRecord,
  writeLog,
} from "../../../server/log.ts"

type SignOutApi = {
  signOut(input: { headers: Headers; asResponse: true }): Promise<Response>
}

const authApi: SignOutApi = {
  signOut: async (input) => (await getAuth()).api.signOut(input),
}

// Allowed targets, no open redirect
const NEXT = new Set(["/masuk"])

async function target(request: Request): Promise<string> {
  const form = await request.formData().catch(() => null)
  const next = form?.get("next")
  return typeof next === "string" && NEXT.has(next) ? next : "/"
}

/** Always redirects, session or not. */
export async function signOut(
  request: Request,
  api: SignOutApi = authApi,
  log: (line: LogRecord) => void = writeLog,
): Promise<Response> {
  const to = await target(request)
  const result = await api.signOut({
    headers: request.headers,
    asResponse: true,
  })
  // In-process: auth hook skips
  const url = new URL(request.url)
  log(
    securityRecord("auth_ok", {
      host: url.host,
      path: url.pathname,
      factor: "sign_out",
      user_id: requestScope()?.userId ?? null,
    }),
  )
  const headers = new Headers()
  for (const cookie of result.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie)
  }
  return redirect(to, { status: 303, headers })
}
