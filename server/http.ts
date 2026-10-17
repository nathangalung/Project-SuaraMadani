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
