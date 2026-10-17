import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { PgBoss } from "pg-boss"
import { runJobsCli } from "./jobs-cli.ts"
import { migrate } from "./migrate.ts"
import { superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()
const boss = new PgBoss({
  connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
  max: 2,
  supervise: false,
  schedule: false,
  migrate: false,
  createSchema: false,
})
const REQ = "jobs-cli-test"

async function cli(...args: string[]) {
  const lines: string[] = []
  const code = await runJobsCli(args, boss, (line) => lines.push(line))
  return { code, lines }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  boss.on("error", () => {})
  await boss.start()
  await su.query("DELETE FROM pgboss.job WHERE name LIKE 'takedown%'")
  // One job dead-lettered for real
  await boss.send(
    "takedown",
    { orgId: "o", takedownId: "t", reqId: REQ },
    {
      retryLimit: 0,
    },
  )
  const [job] = await boss.fetch("takedown")
  await boss.fail("takedown", job?.id ?? "", { reason: "test" })
})

afterAll(async () => {
  await su.query("DELETE FROM pgboss.job WHERE data->>'reqId' = $1", [REQ])
  await boss.stop({ graceful: false })
  await su.end()
})

describe("db/jobs-cli.ts", () => {
  test("lists every dead letter queue with its count", async () => {
    const { code, lines } = await cli("list")
    expect(code).toBe(0)
    expect(lines).toContain("takedown-dlq\t1")
    expect(lines.some((line) => line.startsWith("email-send-dlq\t"))).toBe(true)
  })

  test("refuses queues that are not dead letters", async () => {
    expect((await cli("delete", "takedown", "x")).code).toBe(2)
    expect((await cli("show", "pgboss")).code).toBe(2)
  })

  test("shows, previews and redrives to the source queue", async () => {
    const shown = await cli("show", "takedown-dlq")
    expect(JSON.parse(shown.lines[0] ?? "{}")).toMatchObject({
      source: "takedown",
      data: { reqId: REQ },
    })
    const preview = await cli("redrive", "takedown-dlq", "--dry-run")
    expect(JSON.parse(preview.lines[0] ?? "{}")).toMatchObject({ total: 1 })
    expect((await cli("redrive", "takedown-dlq")).lines).toEqual([
      "redriven\t1",
    ])
    const { rows } = await su.query(
      "SELECT name FROM pgboss.job WHERE data->>'reqId' = $1 AND state = 'created'",
      [REQ],
    )
    expect(rows).toEqual([{ name: "takedown" }])
  })

  test("deletes one dead letter by id", async () => {
    await boss.send("takedown-dlq", { reqId: REQ })
    const [job] = await boss.findJobs("takedown-dlq", { queued: true })
    expect((await cli("delete", "takedown-dlq", job?.id ?? "")).lines).toEqual([
      "deleted\t1",
    ])
    expect((await cli("list")).lines).toContain("takedown-dlq\t0")
  })
})
