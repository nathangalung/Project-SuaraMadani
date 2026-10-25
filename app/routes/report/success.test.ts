import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { RouterContextProvider } from "react-router"
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
import { sessionContext, tenantContext } from "../../context.ts"
import { loader as layoutLoader } from "./layout"
import { loader } from "./success"

describe("success loader", () => {
  const su = superuserPool()
  const orgs: Record<string, string> = {}
  const SENT = "LPR-2026-10-0001"

  beforeAll(async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
    await resetData(su)
    await insertRegions(su)
    orgs.ITB = await insertOrg(su, "itb")
    orgs.UGM = await insertOrg(su, "ugm")
    const user = await insertUser(su, "sukses@contoh.id")
    const itb = orgs.ITB
    await withTenant(itb, (tx) =>
      tx.insert(reports).values(reportValues(itb, user, { publicCode: SENT })),
    )
  })

  afterAll(async () => {
    await resetData(su)
    await su.end()
  })

  function args(campusCode: string, code: string) {
    const provider = new RouterContextProvider()
    provider.set(sessionContext, null)
    provider.set(tenantContext, {
      id: orgs[campusCode] ?? "",
      slug: campusCode.toLowerCase(),
      host: `${campusCode.toLowerCase()}.localhost`,
      name: `KM ${campusCode}`,
      campusCode,
      campusName: campusCode,
      theme: {},
      settings: {},
    })
    return { params: { code }, context: provider } as unknown as Parameters<
      typeof loader
    >[0]
  }

  async function status(campusCode: string, code: string): Promise<number> {
    try {
      await loader(args(campusCode, code))
      return 200
    } catch (error) {
      return (error as { init?: { status?: number } }).init?.status ?? 500
    }
  }

  test("own campus code renders", async () => {
    expect(await status("ITB", "lpr 2026 10 0001")).toBe(200)
  })

  test("says whether the visitor is signed in", async () => {
    expect((await loader(args("ITB", SENT))).signedIn).toBe(false)
  })

  test("another campus code is not found", async () => {
    expect(await status("UGM", SENT)).toBe(404)
  })

  test("a code never sent is not confirmed", async () => {
    expect(await status("ITB", "LPR-2026-10-0004")).toBe(404)
    // Random codes before 22 Oct
    expect(await status("ITB", "ITB-26-7K3QX")).toBe(404)
  })

  test("Given a campus that paused intake with a status link, when /lapor loads, then the banner facts say so", async () => {
    const banner = async (settings: Record<string, unknown>) => {
      const provider = new RouterContextProvider()
      provider.set(sessionContext, null)
      provider.set(tenantContext, {
        ...args("ITB", SENT).context.get(tenantContext),
        settings,
      })
      const page = await layoutLoader({ context: provider } as never)
      return { paused: page.paused, statusHref: page.statusHref }
    }
    expect(
      await banner({
        intakePaused: true,
        statusUrl: "https://status.contoh.id/",
      }),
    ).toEqual({ paused: true, statusHref: "https://status.contoh.id/" })
    // Script links never shown
    expect(
      await banner({ intakePaused: false, statusUrl: "javascript:alert(1)" }),
    ).toEqual({ paused: false, statusHref: null })
  })
})
