import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Pool } from "pg"
import { migrate } from "./migrate.ts"
import { pgError } from "./tenant.server.ts"
import { superuserPool, testUrl } from "./testing.ts"

const su = superuserPool()
const as = (role: string) =>
  new Pool({
    connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
    max: 1,
    options: `-c role=${role}`,
  })
const backup = as("sm_backup")
const app = as("sm_app")

async function code(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run
    return undefined
  } catch (error) {
    return pgError(error)?.code
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await su.query("DELETE FROM backup_runs")
})

afterAll(async () => {
  await su.query("DELETE FROM backup_runs")
  await Promise.all([su.end(), backup.end(), app.end()])
})

describe("backup_runs", () => {
  test("the backup role records a run and nothing else", async () => {
    await backup.query(
      "INSERT INTO backup_runs (kind, finished_at) VALUES ('restic', now())",
    )
    expect(await code(backup.query("SELECT 1 FROM backup_runs"))).toBe("42501")
    expect(await code(backup.query("DELETE FROM backup_runs"))).toBe("42501")
    expect(await code(backup.query("SELECT 1 FROM reports"))).toBe("42501")
  })

  test("the app role reads runs and cannot write them", async () => {
    const { rows } = await app.query<{ kind: string }>(
      "SELECT kind FROM backup_runs",
    )
    expect(rows.map((row) => row.kind)).toContain("restic")
    expect(
      await code(
        app.query("INSERT INTO backup_runs (kind) VALUES ('pgbackrest')"),
      ),
    ).toBe("42501")
  })

  test("only known kinds", async () => {
    expect(
      await code(su.query("INSERT INTO backup_runs (kind) VALUES ('zip')")),
    ).toBe("23514")
  })
})
