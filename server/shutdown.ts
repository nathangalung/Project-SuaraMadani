import { withDeadline } from "./http.ts"
import type { LogRecord } from "./log.ts"

export type ShutdownDeps = {
  stopServer: (force: boolean) => Promise<void>
  drainEmails: () => Promise<void>
  stopJobs: () => Promise<void>
  endPool: () => Promise<void>
  exit: (code: number) => void
  log: (line: LogRecord) => void
  deadlineMs: number
}

/** Once only, bounded request drain. */
export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
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
    deps.exit(failed ? 1 : 0)
  }

  return () => {
    running ??= sequence()
    return running
  }
}
