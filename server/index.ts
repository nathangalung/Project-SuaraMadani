import { fileURLToPath } from "node:url"
import { createRequestHandler, type ServerBuild } from "react-router"
import { type Database, database } from "../db/client.server.ts"
import { ensureJobs } from "./api/upload.server.ts"
import { createApp, SERVE_LIMITS } from "./app"
import { drainEmails, getAuth } from "./auth.server.ts"
import { trustClientIp } from "./client-ip.ts"
import { errorReporterFromEnv } from "./error-report.ts"
import { poolHealth } from "./health.ts"
import { setErrorReporter, writeError, writeLog } from "./log.ts"
import { hstsPolicy } from "./middleware/security-headers.ts"
import { createShutdown, onFatal, type Shutdown } from "./shutdown.ts"
import { turnstileKeysProblem } from "./turnstile.server.ts"

type DocumentHandler = (request: Request) => Promise<Response>

export type ServerDeps = {
  env: Record<string, string | undefined>
  // SSR build, tests inject
  loadDocument: () => Promise<DocumentHandler>
  database: () => Database
  on: (event: string, listener: (error?: unknown) => void) => void
  exit: (code: number) => void
}

const BUILD = new URL("../build/server/index.js", import.meta.url)

/** react-router build output. */
async function loadBuild(): Promise<DocumentHandler> {
  const build: ServerBuild = await import(BUILD.href)
  return createRequestHandler(build, process.env.NODE_ENV)
}

const PROCESS: ServerDeps = {
  env: process.env,
  loadDocument: loadBuild,
  database,
  on: process.on.bind(process),
  exit: process.exit.bind(process),
}

/** Check, listen, drain on stop. */
export async function startServer(
  deps: ServerDeps = PROCESS,
): Promise<{ server: Bun.Server<undefined>; shutdown: Shutdown }> {
  const { env } = deps
  const handler = await deps.loadDocument()
  // ASVS V13.2.3: always-pass keys
  const dummyKeys = turnstileKeysProblem(env)
  if (dummyKeys) throw new Error(dummyKeys)
  // Bad DSN fails boot
  const reporter = errorReporterFromEnv(env, "web")
  const hsts = hstsPolicy(env.HSTS_POLICY)
  setErrorReporter(reporter)
  const { pool, db, boss } = deps.database()
  // Fail at boot, not later
  await ensureJobs()
  await getAuth()

  const app = createApp({
    handleDocument: (request) => handler(request),
    health: poolHealth(pool, db, {
      backups: env.HEALTH_BACKUP_CHECKS === "true",
    }),
    sha: env.GIT_SHA || undefined,
    healthToken: env.HEALTH_TOKEN || undefined,
    hsts,
    clientDir: fileURLToPath(new URL("../build/client", import.meta.url)),
    cdnTtl: Number(env.ANON_CDN_TTL ?? 60),
  })

  // Caddy's fixed app address
  const proxy = env.TRUSTED_PROXY_IP || undefined
  const server = Bun.serve({
    port: Number(env.PORT ?? 3000),
    ...SERVE_LIMITS,
    fetch: (request, bun) =>
      app.fetch(
        trustClientIp(request, bun.requestIP(request)?.address, proxy),
        bun,
      ),
  })

  writeLog({ msg: "listening", url: server.url.href })

  // Within 30 s stop grace
  const shutdown = createShutdown({
    stopServer: (force) => server.stop(force),
    drainEmails,
    stopJobs: () => boss.stop({ graceful: true, timeout: 10_000 }),
    endPool: () => pool.end(),
    flushErrors: reporter && (() => reporter.flush()),
    exit: deps.exit,
    log: writeLog,
    deadlineMs: 15_000,
  })
  for (const signal of ["SIGINT", "SIGTERM"]) {
    deps.on(signal, () => void shutdown())
  }
  const fatal = onFatal({
    stop: shutdown.fail,
    log: writeError,
    exit: deps.exit,
    graceMs: 25_000,
  })
  deps.on("uncaughtException", fatal)
  deps.on("unhandledRejection", fatal)
  return { server, shutdown }
}

if (import.meta.main) await startServer()
