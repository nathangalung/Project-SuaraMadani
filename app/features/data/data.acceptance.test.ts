import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { database } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  actionData,
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  loaderWith,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import {
  issueRow,
  postForm,
  publishIssue,
  reportToIssue,
  review,
  submitReport,
} from "../../../e2e/staff-flows.ts"
import { formatDateTime, jakartaIsoDate } from "../../../shared/format.ts"
import { createAggregateHandler } from "../../../worker/aggregates.ts"
import type { Dashboard } from "./dashboard.server.ts"

const HOST = "accdata.localhost"
const SMALL = "accdatb.localhost"
// Metrics and map campus
const THIRD = "accdatc.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let orgId = ""
let thirdId = ""
let issueNumber = 0
let admin: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813777${String(seq).padStart(5, "0")}`,
    name: "Warga Data",
  }
}

type Metric = { metric: string; value: number | null }

async function ringkasan(): Promise<Record<string, number | null>> {
  const body = await (await app.request(`${ORIGIN}/api/v1/data`)).json()
  return Object.fromEntries(
    (body.datasets.ringkasan as Metric[]).map((row) => [row.metric, row.value]),
  )
}

const refresh = () => createAggregateHandler({ db: database().db })({})

/** Published issue row, Given only. */
async function issueAt(
  province: string,
  fields: { verified?: number; gov?: string } = {},
): Promise<string> {
  issueNumber += 1
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code, gov_status,
       report_count, verified_report_count, published_at)
     VALUES ($1, 2026, $2, $3, 'Isu uji', 'Ringkasan', 'program',
       'program.pendidikan', $4, $4 || CASE $4 WHEN '32' THEN '.73' ELSE '.74' END,
       $5, $6, $6, now())
     RETURNING id`,
    [
      thirdId,
      issueNumber,
      `ISU-ACCDATC-26-${String(issueNumber).padStart(4, "0")}`,
      province,
      fields.gov ?? "awaiting_response",
      fields.verified ?? 1,
    ],
  )
  return rows[0]?.id ?? ""
}

async function dashboardOf(query = "") {
  const res = await app.request(`http://${THIRD}/data.data${query}`)
  expect(res.status).toBe(200)
  return (
    await loaderWith<{ dashboard: Dashboard & { kind: "ready" } }>(
      res,
      "dashboard",
    )
  ).dashboard
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accdata")
  await insertOrg(su, "accdatb")
  thirdId = await insertOrg(su, "accdatc")
  await su.query(
    `INSERT INTO regions (code, parent_code, level, name)
     VALUES ('33', NULL, 1, 'Jawa Tengah'), ('33.74', '33', 2, 'Kota Semarang')
     ON CONFLICT DO NOTHING`,
  )
  hostsChanged([HOST, SMALL, THIRD])
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgId, person("admin"))
  // Five verified, one issue
  let issue = ""
  for (let i = 0; i < 5; i++) {
    const owner = await signedIn(HOST, person(`warga${i}`))
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
  const rejected = await signedIn(HOST, person("ditolak"))
  const { code } = await submitReport(app, HOST, rejected.cookie)
  await review(app, su, HOST, admin.cookie, code, { intent: "start_review" })
  await review(app, su, HOST, admin.cookie, code, {
    intent: "reject",
    reason: "standard_2",
    reasonText: "Laporan ini menuduh orang yang bisa dikenali tanpa bukti.",
  })
  const waiting = await signedIn(HOST, person("antre"))
  await submitReport(app, HOST, waiting.cookie)
  // Small campus, two reports
  for (let i = 0; i < 2; i++) {
    const owner = await signedIn(SMALL, person(`kecil${i}`))
    await submitReport(app, SMALL, owner.cookie)
  }
})

afterAll(async () => {
  await dropJobs(su, [HOST, SMALL, THIRD])
  // Later files rebuild auth
  hostsChanged([HOST, SMALL, THIRD])
  restore()
  await resetData(su)
  await su.end()
})

describe("dashboard and national numbers", () => {
  test("[AC-DATA-01] Given verified, rejected and waiting reports, when the dashboard job runs, then /data and its API show the snapshot's numbers with the update time, and new reports wait for the next run", async () => {
    await refresh()
    const numbers = await ringkasan()
    expect(numbers).toMatchObject({
      reports_total: 7,
      reports_verified: 5,
      reports_queue: 1,
      issues_published: 1,
      issues_merged_reports: 5,
    })
    const body = await (await app.request(`${ORIGIN}/api/v1/data`)).json()
    expect(Date.parse(body.meta.computedAt)).toBeGreaterThan(
      Date.now() - 60_000,
    )
    const page = await app.request(`${ORIGIN}/data`)
    expect(page.status).toBe(200)
    const computed = formatDateTime(new Date(body.meta.computedAt))
    expect(await page.text()).toContain(`${computed} WIB`)
    const late = await signedIn(HOST, person("baru"))
    await submitReport(app, HOST, late.cookie)
    expect((await ringkasan()).reports_total).toBe(7)
    await refresh()
    expect((await ringkasan()).reports_total).toBe(8)
  })

  test("[AC-DATA-02] Given two campuses, when the apex national view is read after a refresh, then it lists both campuses and hides counts from one to four", async () => {
    await refresh()
    const res = await app.request("http://localhost/.data")
    const home = await loaderWith<{
      scope: string
      view: { campuses: { host: string; received: number | null }[] }
    }>(res, "scope")
    expect(home.scope).toBe("national")
    const received = Object.fromEntries(
      home.view.campuses.map((campus) => [campus.host, campus.received]),
    )
    // Forwarded reports count once
    const stored = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reports WHERE org_id = $1 AND status <> 'forwarded'",
      [orgId],
    )
    expect(received[HOST]).toBe(stored.rows[0]?.n ?? -1)
    // Two reports, so hidden
    expect(received).toHaveProperty([SMALL], null)
  })

  test("[AC-DATA-03] Given referred issues with and without responses, when the dashboard job runs, then the response rate shows its numerator, denominator and N of 14 days, the first-response median and P90 come from at least five answers, and overdue issues are counted per agency, not ranked", async () => {
    const day = (offset: number) =>
      jakartaIsoDate(new Date(Date.now() + offset * 86_400_000))
    const refer = (issue: string, agency: string, sent: number, due: number) =>
      su.query(
        `INSERT INTO referrals (org_id, issue_id, kind, agency, channel, sent_on, deadline_on)
         VALUES ($1, $2, 'referral', $3, 'official_letter', $4, $5)`,
        [thirdId, issue, agency, day(sent), day(due)],
      )
    // Answered after these days
    for (const wait of [2, 4, 6, 8, 10, 20]) {
      const issue = await issueAt("32", { gov: "responded" })
      await refer(issue, "BPBD Kota Bandung", -40, -26)
      await su.query(
        `INSERT INTO responses (org_id, issue_id, agency, body, responded_on, source_url)
         VALUES ($1, $2, 'BPBD Kota Bandung', 'Tanggapan resmi.', $3, 'https://bpbd.example.id/1')`,
        [thirdId, issue, day(-40 + wait)],
      )
    }
    for (const sent of [-30, -30, -3]) {
      const issue = await issueAt("32")
      await refer(issue, "Dinas PU Kota Bandung", sent, sent + 14)
    }
    await refresh()
    const { summary } = await dashboardOf()
    expect(summary.response).toMatchObject({
      days: 14,
      due: 8,
      responded: 5,
      share: 5 / 8,
      firstResponse: { n: 6, medianDays: 7, p90Days: 15 },
      overdue: [{ agency: "Dinas PU Kota Bandung", overdue: 2, referred: 3 }],
      clearAgencies: 1,
    })
  })

  test("[AC-DATA-04] Given verified reports merged into published issues in two provinces and regional tuntutan, when /data is read with ?lapisan=laporan and ?lapisan=tuntutan, then province and map totals from one to four are hidden, larger ones shown, and tuntutan counts are exact and live", async () => {
    await su.query("DELETE FROM referrals WHERE org_id = $1", [thirdId])
    await su.query("DELETE FROM responses WHERE org_id = $1", [thirdId])
    await su.query("DELETE FROM issues WHERE org_id = $1", [thirdId])
    await issueAt("32", { verified: 3 })
    await refresh()
    const cell = (map: Dashboard & { kind: "ready" }, code: string): unknown =>
      map.map.regions.find((region) => region.code === code)?.count
    const small = await dashboardOf("?lapisan=laporan")
    expect(small.map.layer).toBe("laporan")
    expect(cell(small, "32")).toBeNull()
    expect(small.map.total).toBeNull()
    await issueAt("33", { verified: 7 })
    await refresh()
    const both = await dashboardOf()
    expect(both.map.layer).toBe("laporan")
    expect(cell(both, "32")).toBeNull()
    expect(cell(both, "33")).toBe(7)
    expect(both.map.total).toBe(10)
    const staff = await staffSession(THIRD, thirdId, person("peta"))
    const res = await postForm(
      app,
      `http://${THIRD}/kelola/tuntutan/baru`,
      staff.cookie,
      {
        scope: "regional",
        provinceCode: "32",
        regencyCode: "32.73",
        category: "infrastruktur_transportasi",
        title: "Perbaikan jalan di Kota Bandung",
        body: "Kami menuntut perbaikan jalan rusak di seluruh Kota Bandung.",
        summary: "Perbaikan jalan rusak dan jadwal yang terbuka untuk warga.",
        target: "Pemerintah Kota Bandung",
        raisedOn: "2026-08-01",
        items: "Perbaiki jalan utama",
      },
    )
    const code = /\/kelola\/tuntutan\/([^?#]+)/.exec(
      res.headers.get("location") ?? "",
    )?.[1]
    if (!code) throw new Error(`create ${res.status}`)
    const before = await dashboardOf("?lapisan=tuntutan")
    expect(before.map.layer).toBe("tuntutan")
    expect(before.map.total).toBe(0)
    const { rows } = await su.query<{ version: number }>(
      "SELECT version FROM demands WHERE public_code = $1",
      [code],
    )
    const publish = await postForm(
      app,
      `http://${THIRD}/kelola/tuntutan/${code}.data`,
      staff.cookie,
      { intent: "publish", version: String(rows[0]?.version), note: "" },
    )
    expect(await actionData<{ saved?: string }>(publish)).toMatchObject({
      saved: "publish",
    })
    const live = await dashboardOf("?lapisan=tuntutan")
    expect(live.map.layer).toBe("tuntutan")
    expect(cell(live, "32")).toBe(1)
    expect(live.map.total).toBe(1)
  })
})
