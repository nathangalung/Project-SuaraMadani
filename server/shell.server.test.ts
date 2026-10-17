import { describe, expect, test } from "bun:test"
import type { TenantContext } from "../app/context.ts"
import { shellData } from "./shell.server.ts"

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
