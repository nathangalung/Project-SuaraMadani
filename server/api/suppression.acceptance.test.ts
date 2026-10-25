import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { database } from "../../db/client.server.ts"
import { migrate } from "../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../db/testing.ts"
import {
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../e2e/app-harness.ts"
import {
  issueRow,
  reportToIssue,
  review,
  submitReport,
} from "../../e2e/staff-flows.ts"
import { createAggregateHandler } from "../../worker/aggregates.ts"

// Own campus, worker refreshes all
const HOST = "accsup.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let admin: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813888${String(seq).padStart(5, "0")}`,
    name: "Warga Sensor",
  }
}

let issue = ""

/** Verified into the one issue. */
async function verifiedReport(i: number) {
  const owner = await signedIn(HOST, person(`terverifikasi${i}`))
  const { code } = await submitReport(app, HOST, owner.cookie)
  if (!issue) {
    issue = await reportToIssue(app, su, HOST, admin.cookie, code)
    return
  }
  const res = await review(app, su, HOST, admin.cookie, code, {
    intent: "verify",
    method: "document",
    target: "existing",
    issueId: (await issueRow(su, HOST, issue)).id,
  })
  if (res.status !== 303) throw new Error(`verify ${res.status}`)
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  const orgId = await insertOrg(su, "accsup")
  hostsChanged([HOST])
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgId, person("admin"))
  // Four verified, one issue
  for (let i = 0; i < 4; i++) await verifiedReport(i)
  await createAggregateHandler({ db: database().db })({})
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await resetData(su)
  await su.end()
})

/** Every non-header CSV cell. */
async function csvCells(path: string): Promise<string[]> {
  const res = await app.request(`${ORIGIN}${path}`)
  expect(res.status).toBe(200)
  const [, ...rows] = (await res.text()).trim().split("\r\n")
  return rows.flatMap((row) => row.split(","))
}

describe("small counts", () => {
  test("[AC-API-09] Given four and then five verified reports in one province, when the dashboard job has run and the region tables are read, then four is an empty cell, five is shown and the minimum n is published", async () => {
    const province = async () => {
      const body = await (await app.request(`${ORIGIN}/api/v1/data`)).json()
      expect(body.meta.suppression.minPublicN).toBe(5)
      return body.datasets.wilayah.find(
        (row: { province_code: string; category: string; status: string }) =>
          row.province_code === "32" &&
          row.category === "all" &&
          row.status === "all",
      )
    }
    expect(await province()).toMatchObject({ verified_reports: null })
    for (const path of [
      "/api/v1/data/wilayah.csv",
      "/api/v1/data/wilayah-total.csv",
    ]) {
      const cells = await csvCells(path)
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.filter((cell) => /^[1-4]$/.test(cell))).toEqual([])
    }
    await verifiedReport(4)
    await createAggregateHandler({ db: database().db })({})
    expect(await province()).toMatchObject({ verified_reports: 5 })
    expect(await csvCells("/api/v1/data/wilayah-total.csv")).toContain("5")
  })
})
