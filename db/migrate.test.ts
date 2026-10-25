import { describe, expect, spyOn, test } from "bun:test"
import { main } from "./migrate.ts"
import { superuserPool, testUrl } from "./testing.ts"

describe("bun db/migrate.ts", () => {
  test("Given the migrator URL, when run twice, then every journal entry is applied once", async () => {
    const env = { DATABASE_MIGRATOR_URL: testUrl("TEST_DATABASE_MIGRATOR_URL") }
    const logged = spyOn(console, "log").mockImplementation(() => {})
    try {
      await main(env)
      await main(env)
      expect(logged.mock.calls).toEqual([
        [JSON.stringify({ msg: "migrated" })],
        [JSON.stringify({ msg: "migrated" })],
      ])
    } finally {
      logged.mockRestore()
    }
    const journal: { entries: unknown[] } = await Bun.file(
      new URL("./migrations/meta/_journal.json", import.meta.url),
    ).json()
    const su = superuserPool()
    try {
      const { rows } = await su.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      )
      expect(rows[0]?.n).toBe(journal.entries.length)
    } finally {
      await su.end()
    }
  })

  test("refuses to run without the migrator URL", async () => {
    await expect(main({})).rejects.toThrow("DATABASE_MIGRATOR_URL is not set")
  })
})
