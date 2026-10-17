import { PgBoss } from "pg-boss"
import { initDatabase, type PoolProfile } from "../db/client.server.ts"
import type { JobPayloads, QueueName } from "../db/jobs.server.ts"
import { defaultFilesDir } from "../server/files.server.ts"
import { errorRecord, writeLog } from "../server/log.ts"
import { createAggregateHandler } from "./aggregates.ts"
import { createEmailSendHandler } from "./email-send.ts"
import { createEvidenceHandler } from "./evidence.ts"
import { createBriefScanHandler } from "./evidence-brief.ts"
import { createPublishHandler } from "./evidence-publish.ts"
import { createVideoHandler, TRANSCODE_TIMEOUT_S } from "./evidence-video.ts"
import {
  createDemandNotifyHandler,
  createIssueNotifyHandler,
} from "./issue-notify.ts"
import { createMaintenanceHandler } from "./maintenance.ts"
import { mediaStoreFromEnv } from "./media-store.ts"
import { createTakedownHandler } from "./takedown.ts"
import { sweepScratch } from "./tools.ts"
import {
  startWhatsApp,
  type WhatsAppRuntime,
  whatsappEnv,
} from "./whatsapp/runtime.ts"
import { createWhatsAppSendHandler } from "./whatsapp-send.ts"

type WorkerSpec = {
  profile: Exclude<PoolProfile, "web" | "migrate">
  // Below queue expireInSeconds - 10
  timeoutSeconds: number
  localConcurrency: number
}

export const WORKERS: Record<QueueName, WorkerSpec> = {
  // clamd plus pdftoppm budgets
  evidence: {
    profile: "worker-media",
    timeoutSeconds: 285,
    // Two capped decodes: 0.75 GB
    localConcurrency: 2,
  },
  "evidence-video": {
    profile: "worker-media",
    timeoutSeconds: TRANSCODE_TIMEOUT_S + 280,
    localConcurrency: 1,
  },
  "evidence-publish": {
    profile: "worker-media",
    timeoutSeconds: 285,
    localConcurrency: 1,
  },
  // clamd 45 s, no decode
  "evidence-brief": {
    profile: "worker-media",
    timeoutSeconds: 110,
    localConcurrency: 1,
  },
  "aggregate-refresh": {
    profile: "worker",
    timeoutSeconds: 590,
    localConcurrency: 1,
  },
  // Email timeout 10 s
  "email-send": {
    profile: "worker",
    timeoutSeconds: 50,
    localConcurrency: 2,
  },
  "issue-notify": {
    profile: "worker",
    timeoutSeconds: 110,
    localConcurrency: 1,
  },
  "demand-notify": {
    profile: "worker",
    timeoutSeconds: 110,
    localConcurrency: 1,
  },
  // Purge timeout 10 s
  takedown: {
    profile: "worker",
    timeoutSeconds: 50,
    localConcurrency: 1,
  },
  "maintenance-daily": {
    profile: "worker",
    timeoutSeconds: 1790,
    localConcurrency: 1,
  },
  // One socket, paced sends
  "whatsapp-send": {
    profile: "worker-whatsapp",
    timeoutSeconds: 45,
    localConcurrency: 1,
  },
}

// Starting Values: schedules, Asia/Jakarta
export const SCHEDULES: Partial<Record<QueueName, string>> = {
  "aggregate-refresh": "*/15 * * * *",
  // Starting Values, after reboots 03:00
  "maintenance-daily": "0 4 * * *",
}

type Handlers = {
  [Q in QueueName]: (
    data: JobPayloads[Q],
    signal: AbortSignal,
  ) => Promise<unknown>
}
// Built only for selected queues
type HandlerFactories = { [Q in QueueName]: () => Handlers[Q] }

const URL_FOR: Record<WorkerSpec["profile"], string> = {
  worker: "DATABASE_URL",
  "worker-media": "DATABASE_MEDIA_URL",
  // sm_app, creds sealed separately
  "worker-whatsapp": "DATABASE_URL",
}

const STOP_TIMEOUT_MS = 25_000
const TIME_ZONE = "Asia/Jakarta"
const SELF_CHECK_MS = 60_000
const SELF_CHECK_DEAD_MS = 180_000

function isQueue(name: string): name is QueueName {
  return Object.hasOwn(WORKERS, name)
}

/** Parses WORKER_QUEUES, refuses unknown. */
export function selectQueues(value: string | undefined): QueueName[] {
  const names = (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length === 0) throw new Error("WORKER_QUEUES is empty")
  const unknown = names.filter((name) => !isQueue(name))
  if (unknown.length > 0) {
    throw new Error(`Unknown queues in WORKER_QUEUES: ${unknown.join(", ")}`)
  }
  return names.filter(isQueue)
}

/** One role per process. */
export function profileFor(queues: QueueName[]): WorkerSpec["profile"] {
  const profiles = new Set(queues.map((name) => WORKERS[name].profile))
  const [profile] = profiles
  if (!profile || profiles.size > 1) {
    throw new Error("WORKER_QUEUES mixes queues of different profiles")
  }
  return profile
}

/** Compose healthcheck reads the mtime. */
/** Drain jobs, then close WhatsApp. */
export async function stopInOrder(deps: {
  drain: () => Promise<void>
  whatsapp: { stop: () => Promise<void> } | undefined
}): Promise<void> {
  // In-flight codes finish first
  await deps.drain()
  // Row says stopped, not stale
  await deps.whatsapp
    ?.stop()
    .catch((error: unknown) =>
      writeLog({ msg: "whatsapp stop failed", ...errorRecord(error) }),
    )
}

export async function touchHeartbeat(path: string | undefined): Promise<void> {
  if (path) await Bun.write(path, String(Date.now()))
}

async function main(): Promise<void> {
  const queues = selectQueues(process.env.WORKER_QUEUES)
  const profile = profileFor(queues)
  const url = process.env[URL_FOR[profile]]
  if (!url) throw new Error(`${URL_FOR[profile]} is not set`)
  const { pool, db } = initDatabase(profile, url)
  const heartbeat = process.env.WORKER_HEARTBEAT
  // Killed jobs leave decoder files
  if (profile === "worker-media") {
    writeLog({ msg: "scratch swept", dirs: await sweepScratch() })
  }

  // Socket starts before jobs
  let whatsapp: WhatsAppRuntime | undefined
  if (profile === "worker-whatsapp") {
    whatsapp = await startWhatsApp(db, whatsappEnv())
  }

  // worker supervises every queue
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    // sm_media lacks queue table rights
    supervise: profile === "worker",
    // Cron only where scheduled
    schedule: queues.some((name) => Boolean(SCHEDULES[name])),
    migrate: false,
    createSchema: false,
    reindex: false,
  })
  boss.on("error", (error) =>
    writeLog({ msg: "pg-boss error", error: error.message }),
  )
  boss.on("warning", (warning) =>
    writeLog({ msg: "pg-boss warning", warning: warning.message }),
  )
  await boss.start()

  const factories: HandlerFactories = {
    evidence: () => createEvidenceHandler({ filesDir: defaultFilesDir(), db }),
    "evidence-video": () =>
      createVideoHandler({ filesDir: defaultFilesDir(), db }),
    "evidence-publish": () =>
      createPublishHandler({
        filesDir: defaultFilesDir(),
        db,
        store: mediaStoreFromEnv(defaultFilesDir()),
      }),
    "evidence-brief": () =>
      createBriefScanHandler({ filesDir: defaultFilesDir(), db }),
    "aggregate-refresh": () => createAggregateHandler({ db }),
    "email-send": () => createEmailSendHandler(),
    "issue-notify": () => createIssueNotifyHandler(),
    "demand-notify": () => createDemandNotifyHandler(),
    takedown: () => createTakedownHandler(),
    "maintenance-daily": () => createMaintenanceHandler(),
    "whatsapp-send": () => {
      const runtime = whatsapp
      if (!runtime) throw new Error("WhatsApp runtime not started")
      const { jobKey } = whatsappEnv()
      return createWhatsAppSendHandler({
        db,
        jobKey: () => jobKey,
        provider: runtime.provider,
        now: () => new Date(),
        wait: (ms) => Bun.sleep(ms),
      })
    },
  }

  // Generic pairs payload and handler
  async function register<Q extends QueueName>(name: Q): Promise<void> {
    const spec = WORKERS[name]
    const factory: HandlerFactories[Q] = factories[name]
    const handler: Handlers[Q] = factory()
    await boss.work<JobPayloads[Q]>(
      name,
      { localConcurrency: spec.localConcurrency, batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const started = performance.now()
          const signal = AbortSignal.any([
            job.signal,
            AbortSignal.timeout(spec.timeoutSeconds * 1000),
          ])
          try {
            const outcome = await handler(job.data, signal)
            writeLog({
              msg: "job done",
              queue: name,
              job_id: job.id,
              req_id: job.data.reqId,
              outcome,
              dur_ms: Math.round(performance.now() - started),
            })
          } catch (error) {
            writeLog({
              msg: "job failed",
              queue: name,
              job_id: job.id,
              retry: job.retryCount,
              ...errorRecord(error),
            })
            throw error
          }
        }
      },
    )
  }
  for (const name of queues) await register(name)
  for (const name of queues) {
    const cron = SCHEDULES[name]
    // Recomputes state, one catch-up
    if (cron)
      await boss.schedule(name, cron, {}, { tz: TIME_ZONE, missed: "once" })
  }
  writeLog({ msg: "worker started", profile, queues })
  await touchHeartbeat(heartbeat)

  // Exit after 3 min unreachable
  let lastOk = Date.now()
  const selfCheck = setInterval(async () => {
    try {
      await pool.query("select 1")
      lastOk = Date.now()
      await touchHeartbeat(heartbeat)
    } catch (error) {
      writeLog({
        msg: "self-check failed",
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (Date.now() - lastOk > SELF_CHECK_DEAD_MS) process.exit(1)
  }, SELF_CHECK_MS)

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    clearInterval(selfCheck)
    await stopInOrder({
      drain: () =>
        boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS, close: false }),
      whatsapp,
    })
    await pool.end()
    writeLog({ msg: "worker stopped", signal })
    process.exit(0)
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
  process.on("SIGINT", () => void shutdown("SIGINT"))
}

if (import.meta.main) await main()
