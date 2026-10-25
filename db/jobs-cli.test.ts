import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { PgBoss } from "pg-boss"
import { main, runJobsCli } from "./jobs-cli.ts"
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

  test("a delete without a job id prints usage and deletes nothing", async () => {
    const { code, lines } = await cli("delete", "takedown-dlq")
    expect(code).toBe(2)
    expect(lines[0]).toStartWith("usage: bun db/jobs-cli.ts list")
    expect((await cli("list")).lines).toContain("takedown-dlq\t1")
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

describe("bun db/jobs-cli.ts", () => {
  test("Given the migrator URL, when list runs, then it prints every dead letter queue and exits 0", async () => {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      const env = {
        DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL"),
      }
      expect(await main(["list"], env)).toBe(0)
      const lines = logged.mock.calls.map(([line]) => String(line))
      expect(lines.some((line) => line.startsWith("takedown-dlq\t"))).toBe(true)
    } finally {
      logged.mockRestore()
    }
  })

  test("Given an unknown command, when main runs, then it prints usage and exits 2", async () => {
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      const env = {
        DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL"),
      }
      expect(await main(["bogus"], env)).toBe(2)
      const lines = logged.mock.calls.map(([line]) => String(line))
      expect(lines[0]).toStartWith("usage: bun db/jobs-cli.ts list")
    } finally {
      logged.mockRestore()
    }
  })

  test("Given a database without pg-boss, when main runs, then it fails and leaves no client open", async () => {
    const url = new URL(testUrl("TEST_DATABASE_MIGRATOR_URL"))
    url.pathname = "/postgres"
    const open = async () => {
      const { rows } = await su.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = 'postgres' AND application_name = 'migrate'`,
      )
      return rows[0]?.n ?? -1
    }
    await expect(
      main(["list"], { DATABASE_MIGRATOR_URL: url.href }),
    ).rejects.toThrow("pg-boss is not installed")
    // Backend exit lags pool.end
    let left = await open()
    for (let i = 0; i < 20 && left > 0; i++) {
      await Bun.sleep(50)
      left = await open()
    }
    expect(left).toBe(0)
  })

  test("refuses to start without the migrator URL", async () => {
    await expect(main(["list"], {})).rejects.toThrow(
      "DATABASE_MIGRATOR_URL is not set",
    )
  })
})
