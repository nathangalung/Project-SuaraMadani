export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/** Rejects after ms, clears timer. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline exceeded")), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/** Bounded JSON, else null. */
export async function boundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return null
  }
}
