import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { QUEUE_SLOW_AT } from "../../../shared/dashboard.ts"
import { queueSlow } from "./queue-delay.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""

async function queue(org: string, n: number) {
  await su.query(
    `INSERT INTO dashboard_snapshots (org_id, data, computed_at)
     VALUES ($1, jsonb_build_object('reports', jsonb_build_object('queue', $2::int)), now())
     ON CONFLICT (org_id) DO UPDATE SET data = excluded.data`,
    [org, n],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  orgA = await insertOrg(su, "qda")
  orgB = await insertOrg(su, "qdb")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("queue delay banner, PLAN §5.10", () => {
  test("shows from the threshold, per campus", async () => {
    await queue(orgA, QUEUE_SLOW_AT)
    await queue(orgB, QUEUE_SLOW_AT - 1)
    expect(await queueSlow(orgA)).toBe(true)
    expect(await queueSlow(orgB)).toBe(false)
  })

  test("no snapshot yet, no banner", async () => {
    await su.query("DELETE FROM dashboard_snapshots")
    expect(await queueSlow(orgA)).toBe(false)
  })
})
