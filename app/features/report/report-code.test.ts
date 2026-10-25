import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import {
  insertOrg,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { normalizeReportCode } from "../../../shared/report-id.ts"
import { nextReportCode } from "./report-code.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""

const next = (org: string, at: string) =>
  withTenant(org, (tx) => nextReportCode(tx, org, new Date(at)))

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  orgA = await insertOrg(su, "rcoda")
  orgB = await insertOrg(su, "rcodb")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("nextReportCode", () => {
  test("Given a Jakarta month end, when codes are drawn, then the WIB month names them", async () => {
    // 23:59:59 WIB, 31 Oct
    expect(await next(orgA, "2026-10-31T16:59:59Z")).toBe("LPR-2026-10-0001")
    // 00:30 WIB, 1 Nov
    expect(await next(orgA, "2026-10-31T17:30:00Z")).toBe("LPR-2026-11-0001")
    expect(await next(orgA, "2026-11-01T02:00:00Z")).toBe("LPR-2026-11-0002")
    // 00:00 WIB, 1 Jan
    expect(await next(orgA, "2026-12-31T17:00:00Z")).toBe("LPR-2027-01-0001")
  })

  test("Given two campuses, when both draw in one month, then each counts from 0001", async () => {
    const at = "2026-09-15T03:00:00Z"
    expect(await next(orgA, at)).toBe("LPR-2026-09-0001")
    expect(await next(orgA, at)).toBe("LPR-2026-09-0002")
    expect(await next(orgB, at)).toBe("LPR-2026-09-0001")
  })

  test("Given concurrent submissions, when codes are drawn, then none repeats", async () => {
    const at = "2026-08-15T03:00:00Z"
    const codes = await Promise.all(
      Array.from({ length: 5 }, () => next(orgB, at)),
    )
    expect([...codes].sort()).toEqual([
      "LPR-2026-08-0001",
      "LPR-2026-08-0002",
      "LPR-2026-08-0003",
      "LPR-2026-08-0004",
      "LPR-2026-08-0005",
    ])
  })

  test("Given a drawn code, when typed back loosely, then it normalizes to itself", async () => {
    const code = await next(orgB, "2026-07-01T03:00:00Z")
    expect(normalizeReportCode(code.toLowerCase().replaceAll("-", " "))).toBe(
      code,
    )
  })

  test("Given 9999 reports in a month, when one more arrives, then its five digits stay readable", async () => {
    const at = "2026-06-10T03:00:00Z"
    await next(orgA, at)
    await su.query(
      `UPDATE org_counters SET next = 9999
       WHERE org_id = $1 AND kind = 'report' AND year = 2026 AND month = 6`,
      [orgA],
    )
    const code = await next(orgA, at)
    expect(code).toBe("LPR-2026-06-10000")
    expect(normalizeReportCode(code)).toBe(code)
  })
})
