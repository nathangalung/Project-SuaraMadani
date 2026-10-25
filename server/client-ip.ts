const HEADER = "x-client-ip"
const MAPPED = "::ffff:"

/** Header only from the proxy. */
export function trustClientIp(
  request: Request,
  peer: string | null | undefined,
  proxy: string | undefined,
): Request {
  // Unset in dev and tests
  if (!proxy || !request.headers.has(HEADER)) return request
  const from = peer?.startsWith(MAPPED) ? peer.slice(MAPPED.length) : peer
  if (from === proxy) return request
  const headers = new Headers(request.headers)
  headers.delete(HEADER)
  return new Request(request, { headers })
}
