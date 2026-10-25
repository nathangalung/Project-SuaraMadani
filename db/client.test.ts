import { afterAll, expect, type Mock, spyOn, test } from "bun:test"
import {
  createDatabase,
  database,
  initDatabase,
  poolConfig,
} from "./client.server.ts"
import { superuserPool, testUrl, until } from "./testing.ts"

const su = superuserPool()

type Line = Record<string, unknown>
const lines = (spy: Mock<(...args: unknown[]) => void>): Line[] =>
  spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Line)

afterAll(async () => {
  await su.end()
})

test("pool config carries per-profile timeouts", () => {
  const config = poolConfig("postgres://x@localhost/db", "worker-media")
  expect(config.max).toBe(4)
  expect(config.application_name).toBe("worker-media")
  expect(config.options).toContain("-c statement_timeout=60000")
})

test("an idle connection terminated by the server does not crash", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {})
  const { pool } = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
  try {
    const { rows } = await pool.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )
    await su.query("SELECT pg_terminate_backend($1)", [rows[0]?.pid])
    // Weekly query reads level error
    await until(() =>
      lines(logged).some(
        (line) => line.level === "error" && line.code === "57P01",
      ),
    )
    const after = await pool.query<{ ok: number }>("SELECT 1 AS ok")
    expect(after.rows[0]?.ok).toBe(1)
  } finally {
    logged.mockRestore()
    await pool.end()
  }
})

test("a checked-out connection terminated in a transaction does not crash", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {})
  const { pool } = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
  try {
    const client = await pool.connect()
    await client.query("BEGIN")
    const { rows } = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    )
    // Like idle_in_transaction_session_timeout
    await su.query("SELECT pg_terminate_backend($1)", [rows[0]?.pid])
    await until(() =>
      lines(logged).some(
        (line) =>
          line.level === "error" &&
          line.msg === "pg client error" &&
          line.code === "57P01",
      ),
    )
    client.release(true)
    const after = await pool.query<{ ok: number }>("SELECT 1 AS ok")
    expect(after.rows[0]?.ok).toBe(1)
  } finally {
    logged.mockRestore()
    await pool.end()
  }
})

test("a pg-boss error logs one JSON line and does not throw", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {})
  const { pool, boss } = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
  try {
    expect(() =>
      boss.emit("error", new Error("connect ECONNREFUSED")),
    ).not.toThrow()
    expect(logged).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      msg: "pg-boss error",
      error: "Error",
      message: "connect ECONNREFUSED",
    })
  } finally {
    logged.mockRestore()
    await pool.end()
  }
})

test("Given the process database exists, when a second one is initialised, then it refuses", () => {
  // Lazy web default first
  const first = database()
  expect(() => initDatabase("worker", testUrl("TEST_DATABASE_URL"))).toThrow(
    "Database already initialised",
  )
  expect(database()).toBe(first)
})

// Child process, env under control
function underTest(env: Record<string, string | undefined>, code: string) {
  return Bun.spawnSync(["bun", "--no-env-file", "-e", code], {
    cwd: `${import.meta.dir}/..`,
    env: { PATH: process.env.PATH, ...env },
  })
}

test("under test, the app pool refuses a non-test database", () => {
  const run = underTest(
    {
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgres://sb_app:x@127.0.0.1:55432/sadar_bersuara",
    },
    `import { database } from "./db/client.server.ts"
     try { database(); console.log("opened") } catch (e) { console.log(e.message) }`,
  )
  expect(run.stdout.toString()).toContain(
    "TEST_DATABASE_URL must point at a *_test database",
  )
})

test("an inherited development NODE_ENV still runs tests as test", () => {
  const run = Bun.spawnSync(
    ["bun", "test", "db/client.test.ts", "-t", "suite runs as test"],
    {
      cwd: `${import.meta.dir}/..`,
      env: { ...process.env, NODE_ENV: "development" },
    },
  )
  expect(run.stderr.toString()).toContain("1 pass")
  expect(run.exitCode).toBe(0)
})

test("the suite runs as test", () => {
  expect(process.env.NODE_ENV).toBe("test")
})
