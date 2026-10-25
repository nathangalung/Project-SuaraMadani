import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { TenantContext } from "../app/context.ts"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import { shellData, staffLinks } from "./shell.server.ts"

const tenant: TenantContext = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "itb",
  host: "itb.localhost",
  name: "KM ITB",
  campusCode: "ITB",
  campusName: "Institut Teknologi Bandung",
  theme: {},
  settings: {},
}

describe("shellData", () => {
  test("footer year follows Jakarta", () => {
    // 01:00 WIB on 1 January
    const now = new Date("2026-12-31T18:00:00Z")
    expect(shellData(tenant, null, now).year).toBe(2027)
  })
})

describe("intake pause banner", () => {
  const paused = { ...tenant, settings: { intakePaused: true } }

  test("off by default", () => {
    expect(shellData(tenant, null, new Date(), false).intakePaused).toBe(false)
  })

  test("the campus switch shows it", () => {
    expect(shellData(paused, null, new Date(), false).intakePaused).toBe(true)
  })

  test("INTAKE_PAUSED shows it on every campus", () => {
    expect(shellData(tenant, null, new Date(), true).intakePaused).toBe(true)
  })
})

describe("logo", () => {
  test("an uploaded logo replaces the default mark", () => {
    expect(shellData(tenant, null).logoSrc).toBeNull()
    expect(
      shellData({ ...tenant, logoHash: "0123456789abcdef" }, null).logoSrc,
    ).toBe("/logo/0123456789abcdef.webp")
  })
})

describe("staffLinks", () => {
  const su = superuserPool()
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
    await resetData(su)
    ids.a = await insertOrg(su, "shla")
    ids.b = await insertOrg(su, "shlb")
    ids.admin = await insertUser(su, "admin.shl@contoh.id")
    ids.reporter = await insertUser(su, "pelapor.shl@contoh.id")
    ids.platform = await insertUser(su, "platform.shl@contoh.id")
    await su.query(
      `INSERT INTO members (organization_id, user_id, role)
       VALUES ($1, $2, 'admin'), ($1, $3, 'reporter')`,
      [ids.a, ids.admin, ids.reporter],
    )
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [
      ids.platform,
    ])
  })

  afterAll(async () => {
    await resetData(su)
    await su.end()
  })

  test("Given roles, when links are read, then only staff and superadmins see them", async () => {
    const links = (org: string, user: string) =>
      staffLinks(ids[org] ?? "", ids[user] ?? "")
    expect(await links("a", "admin")).toEqual({ manage: true, platform: false })
    expect(await links("b", "admin")).toEqual({
      manage: false,
      platform: false,
    })
    expect(await links("a", "reporter")).toEqual({
      manage: false,
      platform: false,
    })
    expect(await links("a", "platform")).toEqual({
      manage: false,
      platform: true,
    })
  })
})
