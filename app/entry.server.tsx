import type { ReactNode } from "react"
import {
  type RenderToReadableStreamOptions,
  renderToReadableStream,
} from "react-dom/server"
import {
  type EntryContext,
  type HandleErrorFunction,
  isRouteErrorResponse,
  ServerRouter,
} from "react-router"
import { cspFor, newMark } from "../server/csp.server.ts"
import { errorRecord, writeError } from "../server/log.ts"

function cssOf(shell: unknown): string | undefined {
  return shell &&
    typeof shell === "object" &&
    "themeCss" in shell &&
    typeof shell.themeCss === "string"
    ? shell.themeCss
    : undefined
}

// Root loader or 403 shell
export function themeCss(context: EntryContext): string[] {
  const { loaderData, errors } = context.staticHandlerContext
  const fromRoot = cssOf(loaderData.root)
  if (fromRoot !== undefined) return [fromRoot]
  for (const error of Object.values(errors ?? {})) {
    const body: unknown = isRouteErrorResponse(error) ? error.data : null
    const css =
      body && typeof body === "object" && "shell" in body
        ? cssOf(body.shell)
        : undefined
    if (css !== undefined) return [css]
  }
  return []
}

// Whole page, boundaries inline
export async function renderHtml(
  element: ReactNode,
  options: RenderToReadableStreamOptions,
): Promise<string> {
  const stream = await renderToReadableStream(element, {
    ...options,
    progressiveChunkSize: Number.POSITIVE_INFINITY,
  })
  await stream.allReady
  return new Response(stream).text()
}

// Buffered, CSP hashes tagged inline
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  let status = responseStatusCode
  // Tags RR and React scripts
  const mark = newMark()
  const html = await renderHtml(
    <ServerRouter context={routerContext} url={request.url} nonce={mark} />,
    {
      nonce: mark,
      signal: request.signal,
      onError(error: unknown) {
        status = 500
        if (request.signal.aborted) return
        writeError({
          msg: "render error",
          path: new URL(request.url).pathname,
          ...errorRecord(error),
        })
      },
    },
  )
  const page = cspFor(html, {
    dev: import.meta.env.DEV,
    mark,
    styles: themeCss(routerContext),
    mediaOrigin: process.env.MEDIA_PUBLIC_ORIGIN,
  })
  responseHeaders.set("Content-Type", "text/html; charset=utf-8")
  responseHeaders.set("Content-Security-Policy", page.csp)
  return new Response(page.html, { status, headers: responseHeaders })
}

// React Router CSRF errors
const CLIENT_ERRORS = [
  "The `request.url` origin does not match `origin` header",
  "`origin` header is not a valid URL",
]

function clientErrorStatus(error: unknown): number | undefined {
  if (isRouteErrorResponse(error) && error.status < 500) return error.status
  if (
    error instanceof Error &&
    CLIENT_ERRORS.some((text) => error.message.startsWith(text))
  ) {
    return 400
  }
  return undefined
}

// Skip aborts, expected 4xx short
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return
  const path = new URL(request.url).pathname
  const status = clientErrorStatus(error)
  if (status === undefined) {
    writeError({ msg: "server error", path, ...errorRecord(error) })
    return
  }
  // Route responses: request log suffices
  if (!isRouteErrorResponse(error)) {
    writeError({ msg: "client error", status, path })
  }
}
