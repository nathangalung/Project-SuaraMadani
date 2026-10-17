import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
import { reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { revealContact } from "./contact.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const PHONE = "081234567890"
let org = ""
let other = ""
let moderator = ""
let reportId = ""
let silent = ""

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  org = await insertOrg(su, "kta")
  other = await insertOrg(su, "ktb")
  moderator = await insertUser(su, "mod.kontak@contoh.id")
  const reporter = await insertUser(su, "pelapor.kontak@contoh.id")
  await su.query("UPDATE users SET name = 'Rina Pelapor' WHERE id = $1", [
    reporter,
  ])
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(org, reporter))
    .returning({ id: reports.id })
  reportId = row?.id ?? ""
  await su.query(
    "INSERT INTO report_contacts (org_id, report_id, phone, method) VALUES ($1, $2, $3, 'whatsapp')",
    [org, reportId, PHONE],
  )
  const [none] = await suDb
    .insert(reports)
    .values(reportValues(org, reporter, { contactable: false }))
    .returning({ id: reports.id })
  silent = none?.id ?? ""
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

async function audits() {
  const { rows } = await su.query(
    "SELECT actor_id, entity_id, changed_columns, value_hashes FROM audit_log WHERE action = 'report.view_contact'",
  )
  return rows
}

describe("reporter contact, PLAN §5.5", () => {
  test("a admin reads it, every view audited", async () => {
    const input = { reportId, actorId: moderator }
    expect(await revealContact(org, "admin", input)).toEqual({
      name: "Rina Pelapor",
      phone: PHONE,
      method: "whatsapp",
    })
    await revealContact(org, "admin", input)
    const rows = await audits()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ actor_id: moderator, entity_id: reportId })
    // Number and name never logged
    expect(JSON.stringify(rows)).not.toContain(PHONE)
    expect(JSON.stringify(rows)).not.toContain("Rina")
  })

  test("reporters, other campuses and no contact read nothing", async () => {
    const before = (await audits()).length
    const input = { reportId, actorId: moderator }
    expect(await revealContact(org, "reporter", input)).toBeNull()
    expect(await revealContact(other, "admin", input)).toBeNull()
    expect(
      await revealContact(org, "admin", {
        reportId: silent,
        actorId: moderator,
      }),
    ).toBeNull()
    expect(await audits()).toHaveLength(before)
  })
})
