import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import { reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { withdrawForwardConsent } from "./consent.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""
let owner = ""
let other = ""
const CODE = "LPR-2026-10-0001"

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "cna")
  orgB = await insertOrg(su, "cnb")
  owner = await insertUser(su, "setuju.pemilik@contoh.id")
  other = await insertUser(su, "setuju.lain@contoh.id")
  await withTenant(orgA, (tx) =>
    tx.insert(reports).values(
      reportValues(orgA, owner, {
        publicCode: CODE,
        consents: [
          "age_18_plus",
          "accurate",
          "public_issue",
          "aggregate_processing",
          "forward_to_agency",
        ],
      }),
    ),
  )
})

afterAll(async () => {
  await su.end()
})

async function consents(): Promise<string[]> {
  const { rows } = await su.query<{ consents: string[] }>(
    "SELECT consents FROM reports WHERE public_code = $1",
    [CODE],
  )
  return rows[0]?.consents ?? []
}

// CMP-07: UU PDP Pasal 9
describe("withdrawForwardConsent", () => {
  test("another account or campus finds nothing", async () => {
    expect(
      await withdrawForwardConsent({ id: orgA }, { code: CODE, userId: other }),
    ).toEqual({ ok: false, reason: "not_found" })
    expect(
      await withdrawForwardConsent({ id: orgB }, { code: CODE, userId: owner }),
    ).toEqual({ ok: false, reason: "not_found" })
    expect(await consents()).toContain("forward_to_agency")
  })

  test("the owner withdraws once, audited, rest kept", async () => {
    expect(
      await withdrawForwardConsent({ id: orgA }, { code: CODE, userId: owner }),
    ).toEqual({ ok: true, changed: true })
    expect(await consents()).toEqual([
      "age_18_plus",
      "accurate",
      "public_issue",
      "aggregate_processing",
    ])
    expect(
      await withdrawForwardConsent({ id: orgA }, { code: CODE, userId: owner }),
    ).toEqual({ ok: true, changed: false })
    const { rows } = await su.query(
      `SELECT actor_id, entity_type, changed_columns FROM audit_log
       WHERE org_id = $1 AND action = 'report.consent_withdraw'`,
      [orgA],
    )
    expect(rows).toEqual([
      {
        actor_id: owner,
        entity_type: "report",
        changed_columns: ["consents"],
      },
    ])
  })
})
