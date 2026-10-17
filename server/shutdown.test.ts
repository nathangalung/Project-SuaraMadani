import { describe, expect, test } from "bun:test"
import { createShutdown, type ShutdownDeps } from "./shutdown.ts"

function fakes(overrides: Partial<ShutdownDeps> = {}) {
  const calls: string[] = []
  const deps: ShutdownDeps = {
    stopServer: async (force) => {
      calls.push(force ? "stop!" : "stop")
    },
    drainEmails: async () => {
      calls.push("emails")
    },
    stopJobs: async () => {
      calls.push("jobs")
    },
    endPool: async () => {
      calls.push("pool")
    },
    exit: (code) => {
      calls.push(`exit ${code}`)
    },
    log: () => {},
    deadlineMs: 50,
    ...overrides,
  }
  return { deps, calls }
}

describe("shutdown", () => {
  test("drains requests, emails, jobs, then the pool", async () => {
    const { deps, calls } = fakes()
    await createShutdown(deps)()
    expect(calls).toEqual(["stop", "emails", "jobs", "pool", "exit 0"])
  })

  test("a second signal does not run the sequence again", async () => {
    let ends = 0
    const { deps, calls } = fakes({
      endPool: async () => {
        ends++
        await Bun.sleep(10)
      },
    })
    const shutdown = createShutdown(deps)
    await Promise.all([shutdown(), shutdown()])
    expect(ends).toBe(1)
    expect(calls.filter((c) => c.startsWith("exit"))).toEqual(["exit 0"])
  })

  test("a request past the deadline is closed, drain still runs", async () => {
    const { deps, calls } = fakes({
      stopServer: async (force) => {
        calls.push(force ? "stop!" : "stop")
        // Slow upload holds the drain
        if (!force) await new Promise(() => {})
      },
    })
    await createShutdown(deps)()
    expect(calls).toEqual(["stop", "stop!", "emails", "jobs", "pool", "exit 0"])
  })

  test("a failing step is logged and the rest still runs", async () => {
    const lines: Record<string, unknown>[] = []
    const { deps, calls } = fakes({
      stopJobs: async () => {
        throw new Error("boss down")
      },
      log: (line) => lines.push(line),
    })
    await createShutdown(deps)()
    expect(calls).toEqual(["stop", "emails", "pool", "exit 1"])
    expect(lines).toMatchObject([{ msg: "shutdown step failed", step: "jobs" }])
  })
})
