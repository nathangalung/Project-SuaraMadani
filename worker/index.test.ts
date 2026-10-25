import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Pool } from "pg"
import { createDatabase, type Database } from "../db/client.server.ts"
import { QUEUES, type QueueName } from "../db/jobs.server.ts"
import { migrate } from "../db/migrate.ts"
import { requestScope } from "../db/request-scope.ts"
import { superuserPool, testUrl } from "../db/testing.ts"
import { seal } from "../server/seal.ts"
import {
  profileFor,
  runJob,
  SCHEDULES,
  selectQueues,
  startWorker,
  stopInOrder,
  stopOnSignals,
  touchHeartbeat,
  WORKERS,
  type Worker,
} from "./index.ts"

describe("queue settings", () => {
  test("expiry exceeds handler timeout by 10 s", () => {
    for (const [name, worker] of Object.entries(WORKERS)) {
      const queue = QUEUES.find((q) => q.name === name)
      expect(queue?.expireInSeconds).toBeGreaterThanOrEqual(
        worker.timeoutSeconds + 10,
      )
    }
  })

  test("every worked queue has a DLQ", () => {
    // Cron queues retry next tick
    for (const name of Object.keys(WORKERS).filter(
      (n) => !Object.hasOwn(SCHEDULES, n),
    )) {
      const queue = QUEUES.find((q) => q.name === name)
      expect(QUEUES.some((q) => q.name === queue?.deadLetter)).toBe(true)
      expect(queue?.retryBackoff).toBe(true)
    }
  })

  test("aggregate refresh drops overlapping ticks", () => {
    const queue = QUEUES.find((q) => q.name === "aggregate-refresh")
    expect(queue?.policy).toBe("exclusive")
    expect(queue?.retryLimit).toBe(0)
    expect(queue?.deadLetter).toBeUndefined()
    expect(SCHEDULES["aggregate-refresh"]).toEqual({
      cron: "*/15 * * * *",
      missed: "once",
    })
    expect(WORKERS["aggregate-refresh"].profile).toBe("worker")
  })

  test("deadline reminders run once a day at 07:00", () => {
    const queue = QUEUES.find((q) => q.name === "deadline-reminders")
    expect(queue?.policy).toBe("exclusive")
    expect(queue?.deadLetter).toBeUndefined()
    // Email cron never catches up
    expect(SCHEDULES["deadline-reminders"]).toEqual({
      cron: "0 7 * * *",
      missed: "skip",
    })
    expect(SCHEDULES["maintenance-daily"]?.missed).toBe("once")
    expect(WORKERS["deadline-reminders"].profile).toBe("worker")
  })

  test("photo jobs run two at once", () => {
    // Fills the 1.5 cpus quota
    expect(WORKERS.evidence.localConcurrency).toBe(2)
    expect(WORKERS.evidence.profile).toBe("worker-media")
  })

  test("video and publish run one at a time", () => {
    for (const name of ["evidence-video", "evidence-publish"] as const) {
      expect(WORKERS[name].localConcurrency).toBe(1)
      expect(WORKERS[name].profile).toBe("worker-media")
    }
    // Starting Values: ffmpeg 600 s
    const video = QUEUES.find((q) => q.name === "evidence-video")
    expect(video?.expireInSeconds).toBe(900)
    expect(video?.retryLimit).toBe(2)
  })
})

describe("clamd outage", () => {
  // compose.yaml clamav start_period
  const CLAMD_WARMUP_S = 300

  test("scanning queues retry past clamd warm-up", () => {
    for (const name of ["evidence", "evidence-video"]) {
      const queue = QUEUES.find((q) => q.name === name)
      const limit = queue?.retryLimit ?? 0
      const delay = Math.max(queue?.retryDelay ?? 0, 1)
      const cap = queue?.retryDelayMax ?? Number.POSITIVE_INFINITY
      // pg-boss backoff, lower bound
      let total = 0
      for (let n = 0; n < limit; n++) total += Math.min(delay * 2 ** n, cap)
      expect(total).toBeGreaterThanOrEqual(CLAMD_WARMUP_S)
    }
  })
})

describe("WORKER_QUEUES", () => {
  test("parses a comma list", () => {
    expect(selectQueues(" evidence ,")).toEqual(["evidence"])
  })

  test("refuses empty and unknown", () => {
    expect(() => selectQueues(undefined)).toThrow()
    expect(() => selectQueues("")).toThrow()
    expect(() => selectQueues("evidence,nope")).toThrow("nope")
    expect(() => selectQueues("evidence-dlq")).toThrow()
  })

  test("profile follows the queue set", () => {
    expect(profileFor(["evidence"])).toBe("worker-media")
    expect(profileFor(["aggregate-refresh"])).toBe("worker")
    expect(() => profileFor(["evidence", "aggregate-refresh"])).toThrow()
    expect(profileFor(["whatsapp-send"])).toBe("worker-whatsapp")
    expect(() => profileFor(["whatsapp-send", "email-send"])).toThrow()
  })

  test("one WhatsApp socket sends one code at a time", () => {
    expect(WORKERS["whatsapp-send"]).toMatchObject({
      profile: "worker-whatsapp",
      localConcurrency: 1,
    })
  })
})

describe("local worker scripts", () => {
  const scripts = {
    worker: "worker",
    "worker:media": "worker-media",
    "worker:whatsapp": "worker-whatsapp",
  } as const

  // Each script runs one profile
  for (const [script, profile] of Object.entries(scripts)) {
    test(`${script} runs every ${profile} queue`, async () => {
      const pkg = await Bun.file(
        join(import.meta.dir, "../package.json"),
      ).json()
      const command = String(pkg.scripts[script] ?? "")
      const match = /^WORKER_QUEUES=(\S+) bun worker\/index\.ts$/.exec(command)
      const queues = selectQueues(match?.[1])
      expect(profileFor(queues)).toBe(profile)
      const expected = Object.entries(WORKERS)
        .filter(([, spec]) => spec.profile === profile)
        .map(([name]) => name)
      const actual: string[] = [...queues].sort()
      expect(actual).toEqual(expected.sort())
    })
  }
})

describe("heartbeat", () => {
  test("compose healthcheck reads its mtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beat-"))
    const file = join(dir, "alive")
    const before = Date.now()
    await touchHeartbeat(file)
    expect((await stat(file)).mtimeMs).toBeGreaterThanOrEqual(before - 1_000)
    // No path, no file
    await touchHeartbeat(undefined)
    await rm(dir, { recursive: true, force: true })
  })
})

describe("shutdown", () => {
  test("jobs drain before the WhatsApp socket closes", async () => {
    const steps: string[] = []
    await stopInOrder({
      drain: async () => {
        steps.push("drain")
      },
      whatsapp: {
        stop: async () => {
          steps.push("whatsapp")
        },
      },
    })
    expect(steps).toEqual(["drain", "whatsapp"])
    await stopInOrder({ drain: async () => {}, whatsapp: undefined })
  })

  test("a failing WhatsApp stop never blocks the error flush", async () => {
    const steps: string[] = []
    await stopInOrder({
      drain: async () => {
        steps.push("drain")
      },
      whatsapp: {
        stop: async () => {
          throw new Error("socket gone")
        },
      },
      flushErrors: async () => {
        steps.push("errors")
      },
    })
    expect(steps).toEqual(["drain", "errors"])
  })

  test("errors flush after the drain, bounded", async () => {
    // REL-09: crash reports reach GlitchTip
    const steps: string[] = []
    await stopInOrder({
      drain: async () => {
        steps.push("drain")
      },
      whatsapp: undefined,
      flushErrors: async () => {
        steps.push("errors")
      },
    })
    expect(steps).toEqual(["drain", "errors"])
    const started = performance.now()
    await stopInOrder({
      drain: async () => {},
      whatsapp: undefined,
      flushErrors: () => new Promise(() => {}),
      flushMs: 20,
    })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe("job lines", () => {
  const job = (reqId?: string) => ({
    id: "job-1",
    retryCount: 0,
    signal: new AbortController().signal,
    data: reqId ? { reqId } : {},
  })

  test("the request id reaches the handler and both lines", async () => {
    const lines: Record<string, unknown>[] = []
    const log = {
      info: (l: Record<string, unknown>) => lines.push(l),
      error: (l: Record<string, unknown>) => lines.push(l),
    }
    let seen: string | undefined
    await runJob("takedown", job("req-9"), 5, log, async () => {
      seen = requestScope()?.reqId
      return "done"
    })
    expect(seen).toBe("req-9")
    const failed = runJob("takedown", job("req-9"), 5, log, async () => {
      throw new Error("x")
    })
    await expect(failed).rejects.toThrow("x")
    expect(lines.map((l) => [l.msg, l.req_id])).toEqual([
      ["job done", "req-9"],
      ["job failed", "req-9"],
    ])
  })

  test("a cron tick has no scope", async () => {
    const log = { info: () => {}, error: () => {} }
    let seen: unknown = "unset"
    await runJob("maintenance-daily", job(), 5, log, async () => {
      seen = requestScope()
      return "done"
    })
    expect(seen).toBeUndefined()
  })
})

describe("worker process", () => {
  const su = superuserPool()
  const jobKey = Buffer.alloc(32, 7)
  let client: Database
  let scratch = ""
  const exits: number[] = []
  const started: Worker[] = []
  const jobIds: string[] = []

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
    client = createDatabase(testUrl("TEST_DATABASE_URL"), "worker")
    await client.boss.start()
    scratch = await mkdtemp(join(tmpdir(), "worker-proc-"))
    await su.query("DELETE FROM whatsapp_sender")
  })

  const since = new Date()
  const cron = Object.keys(SCHEDULES)

  afterAll(async () => {
    for (const worker of started) await worker.stop("test")
    await su.query("DELETE FROM pgboss.schedule WHERE name = ANY($1)", [cron])
    // Ours, and any cron tick
    await su.query(
      `DELETE FROM pgboss.job WHERE id = ANY($1::uuid[])
       OR (name = ANY($2) AND created_on >= $3)`,
      [jobIds, cron, since],
    )
    await su.query("DELETE FROM whatsapp_sender")
    await client.boss.stop({ graceful: false })
    await client.pool.end()
    await su.end()
    await rm(scratch, { recursive: true, force: true })
  })

  function queuesOf(profile: string): string[] {
    return Object.entries(WORKERS)
      .filter(([, spec]) => spec.profile === profile)
      .map(([name]) => name)
  }

  // Real pools, exit recorded
  async function boot(
    env: Record<string, string>,
    pools: Pool[] = [],
    timing: { selfCheckMs?: number; deadMs?: number } = {},
  ): Promise<Worker> {
    // Other files' leftovers stay unrun
    await su.query(
      "DELETE FROM pgboss.job WHERE name = ANY($1) AND state IN ('created', 'retry')",
      [selectQueues(env.WORKER_QUEUES)],
    )
    const worker = await startWorker(env, {
      connect: (profile, url) => {
        const opened = createDatabase(url, profile)
        pools.push(opened.pool)
        return opened
      },
      exit: (code) => exits.push(code),
      scratchDir: scratch,
      ...timing,
    })
    started.push(worker)
    return worker
  }

  async function settled(name: QueueName, data: object): Promise<string> {
    const id = await client.boss.send(name, data)
    if (!id) throw new Error("job not queued")
    jobIds.push(id)
    for (let tries = 0; tries < 100; tries++) {
      const job = await client.boss.getJobById(name, id)
      if (job && job.state !== "created" && job.state !== "active") {
        return job.state
      }
      await Bun.sleep(100)
    }
    throw new Error(`${name} job never settled`)
  }

  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let tries = 0; tries < 100; tries++) {
      if (await check()) return
      await Bun.sleep(20)
    }
    throw new Error("condition never held")
  }

  test("Given every app role queue, when a job arrives, then it runs and each cron is set in WIB", async () => {
    const beat = join(scratch, "alive")
    const worker = await boot({
      WORKER_QUEUES: queuesOf("worker").join(","),
      DATABASE_URL: testUrl("TEST_DATABASE_URL"),
      WORKER_HEARTBEAT: beat,
    })
    expect((await stat(beat)).isFile()).toBe(true)
    const gone = {
      orgId: crypto.randomUUID(),
      notificationId: crypto.randomUUID(),
    }
    expect(await settled("email-send", gone)).toBe("completed")
    const { rows } = await su.query<{ name: string; cron: string; tz: string }>(
      "SELECT name, cron, timezone AS tz FROM pgboss.schedule WHERE name = ANY($1) ORDER BY name",
      [cron],
    )
    expect(rows).toEqual([
      { name: "aggregate-refresh", cron: "*/15 * * * *", tz: "Asia/Jakarta" },
      { name: "deadline-reminders", cron: "0 7 * * *", tz: "Asia/Jakarta" },
      { name: "maintenance-daily", cron: "0 4 * * *", tz: "Asia/Jakarta" },
    ])
    const before = exits.length
    await worker.stop("SIGTERM")
    // Second signal is ignored
    await worker.stop("SIGINT", 1)
    expect(exits.slice(before)).toEqual([0])
  }, 30_000)

  test("Given every media queue, when it boots, then decoder leftovers go and evidence jobs run", async () => {
    const leftover = join(scratch, "sb-media-killed")
    await mkdir(leftover)
    await boot({
      WORKER_QUEUES: queuesOf("worker-media").join(","),
      DATABASE_MEDIA_URL: testUrl("TEST_DATABASE_URL"),
    })
    expect(await readdir(scratch)).not.toContain("sb-media-killed")
    const missing = {
      orgId: crypto.randomUUID(),
      evidenceId: crypto.randomUUID(),
    }
    expect(await settled("evidence", missing)).toBe("completed")
  }, 30_000)

  test("Given the WhatsApp role, when a sealed code expired, then the log row fails as expired", async () => {
    const status = async () =>
      (await su.query<{ status: string }>("SELECT status FROM whatsapp_sender"))
        .rows[0]?.status
    const worker = await boot({
      WORKER_QUEUES: queuesOf("worker-whatsapp").join(","),
      DATABASE_URL: testUrl("TEST_DATABASE_URL"),
      WHATSAPP_PROVIDER: "dev",
      WHATSAPP_JOB_KEY: jobKey.toString("base64"),
      MAILPIT_URL: "http://127.0.0.1:9",
      EMAIL_FROM: "Uji <uji@contoh.id>",
    })
    expect(await status()).toBe("connected")
    const { rows } = await su.query<{ id: string }>(
      "INSERT INTO whatsapp_log (phone_hash, status) VALUES ('h', 'reserved') RETURNING id",
    )
    const logId = rows[0]?.id ?? ""
    const sealed = seal(
      { to: "+6281234500077", code: "123456", expiresAt: 1 },
      jobKey,
      "job",
    )
    expect(await settled("whatsapp-send", { logId, sealed })).toBe("completed")
    const log = await su.query(
      "SELECT status, error FROM whatsapp_log WHERE id = $1",
      [logId],
    )
    expect(log.rows).toEqual([{ status: "failed", error: "expired" }])
    await su.query("DELETE FROM whatsapp_log WHERE id = $1", [logId])
    await worker.stop("SIGTERM")
    expect(await status()).toBe("stopped")
  }, 30_000)

  test("Given the database stops answering, when the self-check outlives its limit, then the worker exits 1", async () => {
    const beat = join(scratch, "beat")
    const pools: Pool[] = []
    const worker = await boot(
      {
        WORKER_QUEUES: "takedown",
        DATABASE_URL: testUrl("TEST_DATABASE_URL"),
        WORKER_HEARTBEAT: beat,
      },
      pools,
      { selfCheckMs: 20, deadMs: 150 },
    )
    const first = (await stat(beat)).mtimeMs
    // Healthy checks touch the heartbeat
    await until(async () => (await stat(beat)).mtimeMs > first)
    const pool = pools[0]
    if (!pool) throw new Error("no pool")
    const query = pool.query.bind(pool)
    const before = exits.length
    pool.query = (() => Promise.reject(new Error("down"))) as typeof pool.query
    try {
      await until(async () => exits.length > before)
      expect(exits[before]).toBe(1)
    } finally {
      pool.query = query
    }
    await worker.stop("fatal", 1)
  }, 30_000)

  test("Given the database drops, when pg-boss polling fails, then the error is logged and the worker keeps running", async () => {
    const pools: Pool[] = []
    const worker = await boot(
      {
        WORKER_QUEUES: "takedown",
        DATABASE_URL: testUrl("TEST_DATABASE_URL"),
      },
      pools,
      { selfCheckMs: 60_000, deadMs: 120_000 },
    )
    const pool = pools[0]
    if (!pool) throw new Error("no pool")
    const query = pool.query.bind(pool)
    const errors = spyOn(console, "error").mockImplementation(() => {})
    const bossErrors = () =>
      errors.mock.calls.filter((call) =>
        String(call[0]).includes('"msg":"pg-boss error"'),
      )
    const before = exits.length
    pool.query = (() => Promise.reject(new Error("down"))) as typeof pool.query
    try {
      // pg-boss polls every 2 s
      for (let tries = 0; tries < 250 && !bossErrors().length; tries++) {
        await Bun.sleep(20)
      }
      expect(bossErrors().length).toBeGreaterThan(0)
      expect(exits.length).toBe(before)
    } finally {
      pool.query = query
      errors.mockRestore()
    }
    await worker.stop("SIGTERM")
    expect(exits.slice(before)).toEqual([0])
  }, 30_000)
})

describe("process signals", () => {
  function recorder() {
    const calls: [string, number | undefined][] = []
    const worker: Worker = {
      stop: async (signal, code) => {
        calls.push([signal, code])
      },
    }
    return { calls, worker }
  }

  test("Given a running worker, when SIGTERM or SIGINT arrives, then it drains with exit 0", () => {
    const { calls, worker } = recorder()
    const proc = new EventEmitter()
    stopOnSignals(worker, proc, () => {})
    proc.emit("SIGTERM")
    proc.emit("SIGINT")
    expect(calls).toEqual([
      ["SIGTERM", undefined],
      ["SIGINT", undefined],
    ])
  })

  test("Given a running worker, when a crash escapes, then it drains once with exit 1", () => {
    const { calls, worker } = recorder()
    const proc = new EventEmitter()
    stopOnSignals(worker, proc, () => {})
    proc.emit("uncaughtException", new Error("boom"))
    proc.emit("unhandledRejection", new Error("again"))
    expect(calls).toEqual([["fatal", 1]])
  })
})
