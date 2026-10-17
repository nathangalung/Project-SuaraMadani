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
import { SNAPSHOT_VERSION } from "../../../shared/dashboard.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import { loader } from "./success"

describe("success loader", () => {
  const su = superuserPool()
  const orgs: Record<string, string> = {}
  const SENT = "ITB-26-7K3QX"

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
    expect(await status("ITB", "itb-26-7k3qx")).toBe(200)
  })

  test("says whether the visitor is signed in", async () => {
    expect((await loader(args("ITB", SENT))).signedIn).toBe(false)
  })

  test("usual check time from the snapshot", async () => {
    // No snapshot yet, no promise
    expect((await loader(args("ITB", SENT))).verifyHours).toBeNull()
    await su.query(
      `INSERT INTO dashboard_snapshots (org_id, data, computed_at)
       VALUES ($1, $2, now())`,
      [
        orgs.ITB,
        JSON.stringify({
          v: SNAPSHOT_VERSION,
          verifyTime: { n: 12, medianHours: 30, p90Hours: 70 },
        }),
      ],
    )
    expect((await loader(args("ITB", SENT))).verifyHours).toBe(30)
  })

  test("another campus code is not found", async () => {
    expect(await status("UGM", SENT)).toBe(404)
    expect(await status("ITB", "ITBX-26-7K3QX")).toBe(404)
  })

  test("a code never sent is not confirmed", async () => {
    expect(await status("ITB", "ITB-26-ZZZZZ")).toBe(404)
  })
})
