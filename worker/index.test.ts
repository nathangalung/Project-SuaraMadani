import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { QUEUES } from "../db/jobs.server.ts"
import {
  profileFor,
  SCHEDULES,
  selectQueues,
  stopInOrder,
  touchHeartbeat,
  WORKERS,
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
    expect(SCHEDULES["aggregate-refresh"]).toBe("*/15 * * * *")
    expect(WORKERS["aggregate-refresh"].profile).toBe("worker")
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
})
