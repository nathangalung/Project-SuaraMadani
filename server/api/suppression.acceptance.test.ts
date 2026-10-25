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
  postForm,
  publishIssue,
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

async function reject(reason: string) {
  const owner = await signedIn(HOST, person(reason))
  const { code } = await submitReport(app, HOST, owner.cookie)
  await review(app, su, HOST, admin.cookie, code, { intent: "start_review" })
  const res = await review(app, su, HOST, admin.cookie, code, {
    intent: "reject",
    reason,
    reasonText: "Laporan ini tidak memenuhi standar yang dikutip admin.",
  })
  if (res.status !== 303) throw new Error(`reject ${res.status}`)
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
  // Three verified reports, one issue
  let issue = ""
  for (let i = 0; i < 3; i++) {
    const owner = await signedIn(HOST, person(`terverifikasi${i}`))
    const { code } = await submitReport(app, HOST, owner.cookie)
    if (i === 0) {
      issue = await reportToIssue(app, su, HOST, admin.cookie, code)
      await publishIssue(app, su, HOST, admin.cookie, issue)
      continue
    }
    await review(app, su, HOST, admin.cookie, code, { intent: "start_review" })
    await review(app, su, HOST, admin.cookie, code, {
      intent: "verify",
      method: "document",
    })
    await postForm(app, `${ORIGIN}/kelola/laporan/${code}`, admin.cookie, {
      intent: "merge",
      target: "existing",
      issueId: (await issueRow(su, issue)).id,
    })
  }
  // Two hidden, five shown
  for (let i = 0; i < 2; i++) await reject("standard_3")
  for (let i = 0; i < 5; i++) await reject("standard_2")
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
  test("[AC-API-09] Given region and reason counts from one to four from real reports, when the dashboard job has run and the region and reason tables are read, then those cells are empty and the minimum n is published", async () => {
    const res = await app.request(`${ORIGIN}/api/v1/data`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta.suppression.minPublicN).toBe(5)
    const region = body.datasets.wilayah.find(
      (row: { province_code: string; category: string; status: string }) =>
        row.province_code === "32" &&
        row.category === "all" &&
        row.status === "all",
    )
    expect(region).toBeDefined()
    expect(region.verified_reports).toBeNull()
    const reasons = Object.fromEntries(
      body.datasets.alasan.map((row: { reason: string; reports: unknown }) => [
        row.reason,
        row.reports,
      ]),
    )
    expect(reasons).toHaveProperty("standard_3", null)
    expect(reasons).toHaveProperty("standard_2", 5)
    for (const path of [
      "/api/v1/data/wilayah.csv",
      "/api/v1/data/alasan.csv",
    ]) {
      const cells = await csvCells(path)
      expect(cells.length).toBeGreaterThan(0)
      expect(cells.filter((cell) => /^[1-4]$/.test(cell))).toEqual([])
    }
    expect(await csvCells("/api/v1/data/alasan.csv")).toContain("5")
  })
})
