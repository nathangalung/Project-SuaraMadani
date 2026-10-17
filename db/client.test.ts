import { afterAll, expect, spyOn, test } from "bun:test"
import { createDatabase, poolConfig } from "./client.server.ts"
import { superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()

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
    await Bun.sleep(200)
    expect(logged).toHaveBeenCalled()
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
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      msg: "pg-boss error",
      error: "connect ECONNREFUSED",
    })
  } finally {
    logged.mockRestore()
    await pool.end()
  }
})
