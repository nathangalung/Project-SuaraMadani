import { type FetchLike, withDeadline } from "./http.ts"
import { errorRecord, type LogRecord, writeError } from "./log.ts"

type PurgeResult = { skipped: boolean }

export type PurgeClient = {
  purgeUrls(urls: string[]): Promise<PurgeResult>
  purgeHosts(hosts: string[]): Promise<PurgeResult>
}

type PurgeOptions = {
  zoneId: string
  token: string
  fetch?: FetchLike
  timeoutMs?: number
}

// Free plan: 100 URLs/call
const BATCH = 100

export function createPurgeClient(options: PurgeOptions): PurgeClient {
  const enabled = Boolean(options.token && options.zoneId)
  const fetch = options.fetch ?? globalThis.fetch
  const timeout = options.timeoutMs ?? 10_000
  const url = `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/purge_cache`

  async function call(body: Record<string, string[]>): Promise<void> {
    const response = await withDeadline(
      fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        // API10: token never follows redirects
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      }),
      timeout,
    )
    if (!response.ok) throw new Error(`purge failed: ${response.status}`)
  }

  return {
    async purgeUrls(urls) {
      if (!enabled) return { skipped: true }
      for (let i = 0; i < urls.length; i += BATCH) {
        await call({ files: urls.slice(i, i + BATCH) })
      }
      return { skipped: false }
    },
    async purgeHosts(hosts) {
      if (!enabled) return { skipped: true }
      await call({ hosts })
      return { skipped: false }
    },
  }
}

/** No-op until a token exists. */
export function purgeClientFromEnv(): PurgeClient {
  return createPurgeClient({
    zoneId: process.env.CLOUDFLARE_ZONE_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  })
}

export type PurgeDeps = {
  purge?: PurgeClient
  log?: (line: LogRecord) => void
}

/** After commit, never throws. */
export async function purgeQuietly(
  urls: string[],
  context: LogRecord,
  deps: PurgeDeps = {},
): Promise<void> {
  const purge = deps.purge ?? purgeClientFromEnv()
  try {
    await purge.purgeUrls(urls)
  } catch (error) {
    // Error stream: runbook, GlitchTip
    ;(deps.log ?? writeError)({
      msg: "purge failed",
      ...context,
      ...errorRecord(error),
    })
  }
}
