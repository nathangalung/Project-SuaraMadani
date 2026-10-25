import { describe, expect, test } from "bun:test"
import { until } from "../db/testing.ts"
import { createShutdown, onFatal, type ShutdownDeps } from "./shutdown.ts"

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
  test("errors flush last, a hung flush still exits", async () => {
    // REL-09: crash reports reach GlitchTip
    const { deps, calls } = fakes({
      flushErrors: async () => {
        calls.push("errors")
      },
    })
    await createShutdown(deps)()
    expect(calls).toEqual([
      "stop",
      "emails",
      "jobs",
      "pool",
      "errors",
      "exit 0",
    ])
    const hung = fakes({
      flushErrors: () => new Promise(() => {}),
      flushMs: 20,
    })
    await createShutdown(hung.deps)()
    expect(hung.calls.at(-1)).toBe("exit 1")
  })

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

describe("fatal errors", () => {
  // OWASP A10: log, exit 1
  test("a failed shutdown exits 1 after the drain", async () => {
    const { deps, calls } = fakes()
    await createShutdown(deps).fail()
    expect(calls).toEqual(["stop", "emails", "jobs", "pool", "exit 1"])
  })

  test("an unhandled error is logged scrubbed, then stops once", async () => {
    const lines: Record<string, unknown>[] = []
    const exits: number[] = []
    let stops = 0
    const handle = onFatal({
      stop: async () => {
        stops++
      },
      log: (line) => lines.push(line),
      exit: (code) => exits.push(code),
      graceMs: 20,
    })
    handle(new Error("lost ani@contoh.id"))
    handle(new Error("again"))
    expect(stops).toBe(1)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      msg: "fatal",
      error: "Error",
      message: "lost [email]",
    })
    // Hung drain still exits
    await Bun.sleep(40)
    expect(exits).toEqual([1])
  })

  test("Given a drain that fails, when a fatal error arrives, then it exits 1 before the grace ends", async () => {
    const exits: number[] = []
    const handle = onFatal({
      stop: () => Promise.reject(new Error("pool already closed")),
      log: () => {},
      exit: (code) => exits.push(code),
      graceMs: 60_000,
    })
    expect(() => handle(new Error("boom"))).not.toThrow()
    await until(() => exits.length > 0)
    expect(exits).toEqual([1])
  })
})
