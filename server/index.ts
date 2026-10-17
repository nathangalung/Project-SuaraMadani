import { fileURLToPath } from "node:url"
import { createRequestHandler, type ServerBuild } from "react-router"
import { database } from "../db/client.server.ts"
import { ensureJobs } from "./api/upload.server.ts"
import { createApp, SERVE_LIMITS } from "./app"
import { drainEmails, getAuth } from "./auth.server.ts"
import { poolHealth } from "./health.ts"
import { writeLog } from "./log.ts"
import { createShutdown } from "./shutdown.ts"

const buildUrl = new URL("../build/server/index.js", import.meta.url)
const build: ServerBuild = await import(buildUrl.href)
const handler = createRequestHandler(build, process.env.NODE_ENV)

const { pool, db, boss } = database()
// Fail at boot, not later
await ensureJobs()
await getAuth()

const app = createApp({
  handleDocument: (request) => handler(request),
  health: poolHealth(pool, db, {
    backups: process.env.HEALTH_BACKUP_CHECKS === "true",
  }),
  sha: process.env.GIT_SHA || undefined,
  clientDir: fileURLToPath(new URL("../build/client", import.meta.url)),
  cdnTtl: Number(process.env.ANON_CDN_TTL ?? 60),
})

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  ...SERVE_LIMITS,
  fetch: app.fetch,
})

writeLog({ msg: "listening", url: server.url.href })

// Within 30 s stop grace
const shutdown = createShutdown({
  stopServer: (force) => server.stop(force),
  drainEmails,
  stopJobs: () => boss.stop({ graceful: true, timeout: 10_000 }),
  endPool: () => pool.end(),
  exit: (code) => process.exit(code),
  log: writeLog,
  deadlineMs: 15_000,
})
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown)
}
