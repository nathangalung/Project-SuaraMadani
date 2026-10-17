import { afterAll, describe, expect, test } from "bun:test"
import { Pool } from "pg"
import { migrate } from "./migrate.ts"
import { superuserPool, testUrl } from "./testing.ts"

// CI hosts start empty
const NAME = "sm_fresh_test"
const su = superuserPool()

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

// DROP forces a slow checkpoint
afterAll(async () => {
  await su.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`)
  await su.end()
}, 60_000)

describe("fresh database", () => {
  test("every migration applies from zero", async () => {
    await su.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`)
    await su.query(`CREATE DATABASE ${NAME} OWNER sm_migrator`)
    const fresh = new Pool({
      connectionString: withDatabase(
        testUrl("TEST_DATABASE_SUPERUSER_URL"),
        NAME,
      ),
      max: 1,
    })
    // DROP FORCE may beat end()
    fresh.on("error", () => {})
    try {
      // Mirrors infra/initdb.sql
      await fresh.query(`
        CREATE EXTENSION IF NOT EXISTS postgis;
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        ALTER SCHEMA public OWNER TO sm_migrator;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO sm_app, sm_media, sm_backup`)
      await migrate(withDatabase(testUrl("TEST_DATABASE_MIGRATOR_URL"), NAME))
      const { rows } = await fresh.query<{ forced: number }>(
        `SELECT count(*)::int AS forced FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relforcerowsecurity`,
      )
      expect(rows[0]?.forced).toBe(23)
    } finally {
      await fresh.end()
    }
  }, 60_000)
})
