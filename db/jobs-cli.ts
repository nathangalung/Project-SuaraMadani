import { PgBoss } from "pg-boss"
import { QUEUES } from "./jobs.server.ts"

// DLQ triage, docs/runbook.md#dead-letters
const DEAD_LETTERS = QUEUES.flatMap((queue) =>
  queue.deadLetter ? [queue.deadLetter] : [],
)
const USAGE = [
  "usage: bun db/jobs-cli.ts list",
  "       bun db/jobs-cli.ts show <dlq>",
  "       bun db/jobs-cli.ts redrive <dlq> [--dry-run]",
  "       bun db/jobs-cli.ts delete <dlq> <job-id>",
].join("\n")

type Out = (line: string) => void

function deadLetter(name: string | undefined): string | null {
  return name && DEAD_LETTERS.includes(name) ? name : null
}

/** Exit code, payloads hold IDs. */
export async function runJobsCli(
  args: string[],
  boss: PgBoss,
  out: Out,
): Promise<number> {
  const [command, name, extra] = args
  if (command === "list") {
    for (const queue of DEAD_LETTERS) {
      const jobs = await boss.findJobs(queue, { queued: true })
      out(`${queue}\t${jobs.length}`)
    }
    return 0
  }
  const queue = deadLetter(name)
  if (!queue) {
    out(USAGE)
    out(`dead letter queues: ${DEAD_LETTERS.join(", ")}`)
    return 2
  }
  if (command === "show") {
    for (const job of await boss.findJobs(queue, { queued: true })) {
      out(
        JSON.stringify({
          id: job.id,
          created: job.createdOn,
          source: job.sourceName,
          data: job.data,
          output: job.output,
        }),
      )
    }
    return 0
  }
  if (command === "redrive") {
    if (extra === "--dry-run") {
      out(JSON.stringify(await boss.previewRedrive(queue)))
      return 0
    }
    out(`redriven\t${await boss.redrive(queue)}`)
    return 0
  }
  if (command === "delete" && extra) {
    // Typed response carries no count
    const found = await boss.findJobs(queue, { id: extra })
    if (found.length > 0) await boss.deleteJob(queue, extra)
    out(`deleted\t${found.length}`)
    return found.length > 0 ? 0 : 1
  }
  out(USAGE)
  return 2
}

if (import.meta.main) {
  const url = process.env.DATABASE_MIGRATOR_URL
  if (!url) throw new Error("DATABASE_MIGRATOR_URL is not set")
  const boss = new PgBoss({
    connectionString: url,
    max: 1,
    application_name: "jobs-cli",
    supervise: false,
    schedule: false,
    migrate: false,
    createSchema: false,
  })
  boss.on("error", (error) => console.error(error.message))
  await boss.start()
  try {
    process.exitCode = await runJobsCli(process.argv.slice(2), boss, (line) =>
      console.log(line),
    )
  } finally {
    await boss.stop({ graceful: false })
  }
}
