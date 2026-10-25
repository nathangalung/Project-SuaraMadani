import { withDeadline } from "./http.ts"
import { errorRecord, type LogRecord } from "./log.ts"

export type ShutdownDeps = {
  stopServer: (force: boolean) => Promise<void>
  drainEmails: () => Promise<void>
  stopJobs: () => Promise<void>
  endPool: () => Promise<void>
  // GlitchTip queue, optional
  flushErrors?: () => Promise<void>
  flushMs?: number
  exit: (code: number) => void
  log: (line: LogRecord) => void
  deadlineMs: number
}

export type Shutdown = (() => Promise<void>) & {
  // Drain, then exit 1
  fail: () => Promise<void>
}

/** Once only, bounded request drain. */
export function createShutdown(deps: ShutdownDeps): Shutdown {
  let running: Promise<void> | undefined
  let failed = false

  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      failed = true
      deps.log({
        msg: "shutdown step failed",
        step: name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const sequence = async () => {
    // Uploads may outlive the grace
    await withDeadline(deps.stopServer(false), deps.deadlineMs).catch(() =>
      step("requests", () => deps.stopServer(true)),
    )
    await step("emails", deps.drainEmails)
    await step("jobs", deps.stopJobs)
    await step("pool", deps.endPool)
    const flush = deps.flushErrors
    if (flush) {
      await step("errors", () => withDeadline(flush(), deps.flushMs ?? 2000))
    }
    deps.exit(failed ? 1 : 0)
  }

  const run = () => {
    running ??= sequence()
    return running
  }
  return Object.assign(run, {
    fail: () => {
      failed = true
      return run()
    },
  })
}

type FatalDeps = {
  stop: () => Promise<void>
  log: (line: LogRecord) => void
  exit: (code: number) => void
  graceMs: number
}

/** OWASP A10: log, drain, fail. */
export function onFatal(deps: FatalDeps): (error: unknown) => void {
  let stopping = false
  return (error) => {
    deps.log({ msg: "fatal", ...errorRecord(error) })
    if (stopping) return
    stopping = true
    // A hung drain still exits
    setTimeout(() => deps.exit(1), deps.graceMs).unref()
    void deps.stop().catch(() => deps.exit(1))
  }
}
