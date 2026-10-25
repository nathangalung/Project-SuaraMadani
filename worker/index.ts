import { PgBoss } from "pg-boss"
import {
  type Database,
  initDatabase,
  type PoolProfile,
} from "../db/client.server.ts"
import type { JobPayloads, QueueName } from "../db/jobs.server.ts"
import { inRequestScope } from "../db/request-scope.ts"
import { errorReporterFromEnv } from "../server/error-report.ts"
import { defaultFilesDir } from "../server/files.server.ts"
import { withDeadline } from "../server/http.ts"
import {
  errorRecord,
  type LogRecord,
  setErrorReporter,
  writeError,
  writeLog,
} from "../server/log.ts"
import { onFatal } from "../server/shutdown.ts"
import { createAggregateHandler } from "./aggregates.ts"
import { createDeadlineReminderHandler } from "./deadline-reminders.ts"
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
import { createSurveySendHandler } from "./survey-send.ts"
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
    // Two HEIC decodes: 0.90 GB
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
  "deadline-reminders": {
    profile: "worker",
    timeoutSeconds: 290,
    localConcurrency: 1,
  },
  "survey-send": {
    profile: "worker",
    timeoutSeconds: 110,
    localConcurrency: 1,
  },
  // One socket, paced sends
  "whatsapp-send": {
    profile: "worker-whatsapp",
    timeoutSeconds: 45,
    localConcurrency: 1,
  },
}

type Schedule = {
  cron: string
  // once: state jobs, skip: email
  missed: "once" | "skip"
}

// Starting Values: schedules, Asia/Jakarta
export const SCHEDULES: Partial<Record<QueueName, Schedule>> = {
  "aggregate-refresh": { cron: "*/15 * * * *", missed: "once" },
  // Starting Values, after reboots 03:00
  "maintenance-daily": { cron: "0 4 * * *", missed: "once" },
  // Quiet hours end 07:00
  "deadline-reminders": { cron: "0 7 * * *", missed: "skip" },
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
  // sb_app, creds sealed separately
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
  flushErrors?: () => Promise<void>
  flushMs?: number
}): Promise<void> {
  // In-flight codes finish first
  await deps.drain()
  // Row says stopped, not stale
  await deps.whatsapp
    ?.stop()
    .catch((error: unknown) =>
      writeLog({ msg: "whatsapp stop failed", ...errorRecord(error) }),
    )
  // Bounded, GlitchTip may hang
  if (deps.flushErrors) {
    await withDeadline(deps.flushErrors(), deps.flushMs ?? 2000).catch(
      (error: unknown) =>
        writeLog({ msg: "error flush failed", ...errorRecord(error) }),
    )
  }
}

export async function touchHeartbeat(path: string | undefined): Promise<void> {
  if (path) await Bun.write(path, String(Date.now()))
}

type JobLog = {
  info: (line: LogRecord) => void
  error: (line: LogRecord) => void
}
const JOB_LOG: JobLog = { info: writeLog, error: writeError }

type RunnableJob<T> = {
  id: string
  data: T
  retryCount: number
  signal: AbortSignal
}

/** One job, logged, request scoped. */
export async function runJob<T extends { reqId?: string }>(
  queue: string,
  job: RunnableJob<T>,
  timeoutSeconds: number,
  log: JobLog,
  handler: (data: T, signal: AbortSignal) => Promise<unknown>,
): Promise<void> {
  const started = performance.now()
  const signal = AbortSignal.any([
    job.signal,
    AbortSignal.timeout(timeoutSeconds * 1000),
  ])
  const reqId = job.data.reqId
  // Audit rows and child jobs
  const run = () => handler(job.data, signal)
  try {
    const outcome = await (reqId ? inRequestScope({ reqId }, run) : run())
    log.info({
      msg: "job done",
      queue,
      job_id: job.id,
      req_id: reqId,
      outcome,
      dur_ms: Math.round(performance.now() - started),
    })
  } catch (error) {
    log.error({
      msg: "job failed",
      queue,
      job_id: job.id,
      req_id: reqId,
      retry: job.retryCount,
      ...errorRecord(error),
    })
    throw error
  }
}

type Env = Partial<Record<string, string>>

type WorkerDeps = {
  // Tests pass their own pool
  connect: (
    profile: WorkerSpec["profile"],
    url: string,
  ) => Pick<Database, "pool" | "db">
  exit: (code: number) => void
  scratchDir?: string
  selfCheckMs: number
  deadMs: number
}

const PROCESS_DEPS: WorkerDeps = {
  connect: initDatabase,
  exit: process.exit,
  selfCheckMs: SELF_CHECK_MS,
  deadMs: SELF_CHECK_DEAD_MS,
}

export type Worker = {
  stop: (signal: string, code?: number) => Promise<void>
}

/** Boots queues, returns the stopper. */
export async function startWorker(
  env: Env,
  overrides: Partial<WorkerDeps> = {},
): Promise<Worker> {
  const deps: WorkerDeps = { ...PROCESS_DEPS, ...overrides }
  const queues = selectQueues(env.WORKER_QUEUES)
  const profile = profileFor(queues)
  // Bad DSN fails boot
  const reporter = errorReporterFromEnv(env, profile)
  setErrorReporter(reporter)
  const url = env[URL_FOR[profile]]
  if (!url) throw new Error(`${URL_FOR[profile]} is not set`)
  const { pool, db } = deps.connect(profile, url)
  const heartbeat = env.WORKER_HEARTBEAT
  // Killed jobs leave decoder files
  if (profile === "worker-media") {
    writeLog({
      msg: "scratch swept",
      dirs: await sweepScratch(deps.scratchDir),
    })
  }

  // Socket starts before jobs
  let whatsapp: WhatsAppRuntime | undefined
  if (profile === "worker-whatsapp") {
    whatsapp = await startWhatsApp(db, whatsappEnv(env), env)
  }

  // worker supervises every queue
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    // sb_media lacks queue table rights
    supervise: profile === "worker",
    // Cron only where scheduled
    schedule: queues.some((name) => Boolean(SCHEDULES[name])),
    migrate: false,
    createSchema: false,
    reindex: false,
  })
  boss.on("error", (error) =>
    writeError({ msg: "pg-boss error", ...errorRecord(error) }),
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
    "deadline-reminders": () => createDeadlineReminderHandler(),
    "survey-send": () => createSurveySendHandler(),
    "whatsapp-send": () => {
      const runtime = whatsapp
      if (!runtime) throw new Error("WhatsApp runtime not started")
      const { jobKey } = whatsappEnv(env)
      return createWhatsAppSendHandler({
        db,
        jobKey: () => jobKey,
        provider: runtime.provider,
        now: () => new Date(),
        wait: Bun.sleep,
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
          await runJob(
            name,
            job,
            spec.timeoutSeconds,
            JOB_LOG,
            (data, signal) => handler(data, signal),
          )
        }
      },
    )
  }
  for (const name of queues) await register(name)
  for (const name of queues) {
    const schedule = SCHEDULES[name]
    if (schedule) {
      await boss.schedule(
        name,
        schedule.cron,
        {},
        { tz: TIME_ZONE, missed: schedule.missed },
      )
    }
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
    if (Date.now() - lastOk > deps.deadMs) deps.exit(1)
  }, deps.selfCheckMs)

  let stopping = false
  return {
    async stop(signal, code = 0) {
      if (stopping) return
      stopping = true
      clearInterval(selfCheck)
      await stopInOrder({
        drain: () =>
          boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS, close: false }),
        whatsapp,
        flushErrors: reporter && (() => reporter.flush()),
      })
      await pool.end()
      writeLog({ msg: "worker stopped", signal })
      deps.exit(code)
    },
  }
}

type Signals = {
  on: (event: string, listener: (error?: unknown) => void) => unknown
}

/** Signals drain, crashes exit 1. */
export function stopOnSignals(
  worker: Worker,
  proc: Signals,
  exit: (code: number) => void,
): void {
  proc.on("SIGTERM", () => void worker.stop("SIGTERM"))
  proc.on("SIGINT", () => void worker.stop("SIGINT"))
  const fatal = onFatal({
    stop: () => worker.stop("fatal", 1),
    log: writeError,
    exit,
    // Past the drain timeout
    graceMs: STOP_TIMEOUT_MS + 10_000,
  })
  proc.on("uncaughtException", fatal)
  proc.on("unhandledRejection", fatal)
}

if (import.meta.main) {
  stopOnSignals(await startWorker(process.env), process, PROCESS_DEPS.exit)
}
