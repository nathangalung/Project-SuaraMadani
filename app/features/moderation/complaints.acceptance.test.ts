import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  CAPTCHA_PASS,
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  mailbox,
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
  submitReport,
} from "../../../e2e/staff-flows.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import {
  changeDemandState,
  createDemand,
  type DemandTenant,
  getManagedDemand,
} from "../demands/manage.server.ts"

const HOST = "acccmp.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
const YEAR = jakartaIsoDate(new Date()).slice(2, 4)
let app: FullApp
let orgId = ""
let first: Staff
let second: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62812888${String(seq).padStart(5, "0")}`,
    name: `Pengadu ${label.replace(/\d/g, "")}`,
  }
}

async function publishedIssue(): Promise<string> {
  const owner = await signedIn(HOST, person("pelapor"))
  const { code } = await submitReport(app, HOST, owner.cookie)
  const issue = await reportToIssue(app, su, HOST, first.cookie, code)
  await publishIssue(app, su, HOST, first.cookie, issue)
  return issue
}

function complain(
  cookie: string,
  path: string,
  overrides: Record<string, string> = {},
) {
  return postForm(app, `${ORIGIN}${path}/laporkan`, cookie, {
    submissionId: crypto.randomUUID(),
    reason: "personal_data",
    part: "title_summary",
    explanation: "Ringkasan menyebut nama lengkap warga yang bisa dikenali.",
    goodFaith: "yes",
    turnstileToken: CAPTCHA_PASS,
    ...overrides,
  })
}

/** Receipt code from the redirect. */
function receiptCode(res: Response): string {
  const location = res.headers.get("location") ?? ""
  const code = /\/aduan\/([^?#]+)/.exec(location)?.[1]
  if (res.status !== 303 || !code) {
    throw new Error(`complaint ${res.status} ${location}`)
  }
  return code
}

function decide(
  staff: Staff,
  complaint: string,
  fields: Record<string, string>,
) {
  return postForm(app, `${ORIGIN}/kelola/aduan/${complaint}`, staff.cookie, {
    stage: "first",
    statement: "Bagian yang diadukan memuat data pribadi warga.",
    ...fields,
  })
}

async function emailOf(userId: string): Promise<string> {
  const { rows } = await su.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  )
  return rows[0]?.email ?? ""
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "acccmp")
  hostsChanged([HOST])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  first = await staffSession(HOST, orgId, person("admin1"))
  second = await staffSession(HOST, orgId, person("admin2"))
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await resetData(su)
  await su.end()
})

describe("content complaints", () => {
  test("[AC-COMPLAINT-01] Given a published issue, when a signed-in person files a complaint with a reason, the part and the good-faith statement, then a receipt page and email confirm it, and an incomplete or anonymous complaint is refused", async () => {
    const issue = await publishedIssue()
    const anonymous = await complain("", `/isu/${issue}`)
    expect(anonymous.status).toBe(401)
    const filer = await signedIn(HOST, person("adu"))
    const noFaith = await complain(filer.cookie, `/isu/${issue}`, {
      goodFaith: "",
    })
    expect(noFaith.status).toBe(400)
    const robot = await complain(filer.cookie, `/isu/${issue}`, {
      turnstileToken: "robot",
    })
    expect(robot.status).toBe(403)
    const code = receiptCode(await complain(filer.cookie, `/isu/${issue}`))
    expect(code).toMatch(new RegExp(`^ADU-ACCCMP-${YEAR}-`))
    const receipt = await app.request(`${ORIGIN}/aduan/${code}`, {
      headers: { cookie: filer.cookie },
    })
    expect(receipt.status).toBe(200)
    expect(receipt.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await receipt.text()).toContain(code)
    const box = mailbox()
    await box.deliver(su, orgId)
    const address = await emailOf(filer.userId)
    const mine = box.sent.filter((m) => m.to === address)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.text).toContain(code)
    const stranger = await signedIn(HOST, person("lain"))
    const peek = await app.request(`${ORIGIN}/aduan/${code}`, {
      headers: { cookie: stranger.cookie },
    })
    expect(peek.status).toBe(404)
  })

  test("[AC-COMPLAINT-02] Given a person who filed ten complaints today at a campus, when an eleventh is filed, then the server answers 429", async () => {
    const issue = await publishedIssue()
    const filer = await signedIn(HOST, person("banyak"))
    for (let i = 0; i < 10; i++) {
      receiptCode(await complain(filer.cookie, `/isu/${issue}`))
    }
    const over = await complain(filer.cookie, `/isu/${issue}`)
    expect(over.status).toBe(429)
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM content_complaints WHERE user_id = $1",
      [filer.userId],
    )
    expect(rows[0]?.n).toBe(10)
  })

  test("[AC-COMPLAINT-03] Given a complaint in the queue, when an admin opens it, then the complainant's identity is never shown", async () => {
    const issue = await publishedIssue()
    const filer = await signedIn(HOST, person("rahasia"))
    const code = receiptCode(await complain(filer.cookie, `/isu/${issue}`))
    const page = await app.request(`${ORIGIN}/kelola/aduan/${code}`, {
      headers: { cookie: first.cookie },
    })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain(code)
    expect(html).not.toContain(await emailOf(filer.userId))
    expect(html).not.toContain("Pengadu rahasia")
  })

  test("[AC-COMPLAINT-04] Given complaints on published issues, when an admin edits, hides or removes them with a numbered standard, then the public pages change accordingly and the complainant is told the decision", async () => {
    const filer = await signedIn(HOST, person("putus"))
    const edited = await publishedIssue()
    const editCode = receiptCode(await complain(filer.cookie, `/isu/${edited}`))
    const hidden = await publishedIssue()
    const hideCode = receiptCode(await complain(filer.cookie, `/isu/${hidden}`))
    const removed = await publishedIssue()
    const removeCode = receiptCode(
      await complain(filer.cookie, `/isu/${removed}`),
    )
    // Receipts out before deciding
    await mailbox().deliver(su, orgId)

    const editRow = await issueRow(su, edited)
    const edit = await decide(first, editCode, {
      intent: "edit",
      reason: "standard_3",
      subjectVersion: String(editRow.version),
      title: "Lampu jalan padam di sebuah kelurahan",
      summary: "Lampu jalan di jalan utama padam sejak dua minggu.",
    })
    expect(edit.status).toBe(303)
    const editedPage = await (
      await app.request(`${ORIGIN}/isu/${edited}`)
    ).text()
    expect(editedPage).toContain("Lampu jalan padam di sebuah kelurahan")
    expect(editedPage).toContain("Disunting admin")

    const hide = await decide(first, hideCode, {
      intent: "hide",
      reason: "standard_3",
      confirm: "yes",
      subjectVersion: String((await issueRow(su, hidden)).version),
    })
    expect(hide.status).toBe(303)
    expect((await app.request(`${ORIGIN}/isu/${hidden}`)).status).toBe(404)

    const unconfirmed = await decide(first, removeCode, {
      intent: "remove",
      reason: "standard_3",
      subjectVersion: String((await issueRow(su, removed)).version),
    })
    expect(unconfirmed.status).toBe(400)
    const remove = await decide(first, removeCode, {
      intent: "remove",
      reason: "standard_3",
      confirm: "yes",
      subjectVersion: String((await issueRow(su, removed)).version),
    })
    expect(remove.status).toBe(303)
    const gone = await app.request(`${ORIGIN}/isu/${removed}`)
    expect(gone.status).toBe(410)

    const box = mailbox()
    await box.deliver(su, orgId)
    const address = await emailOf(filer.userId)
    for (const code of [editCode, hideCode, removeCode]) {
      const told = box.sent.filter(
        (m) => m.to === address && m.text.includes(code),
      )
      expect(told).toHaveLength(1)
    }
  })

  test("[AC-COMPLAINT-05] Given a decided complaint, when the complainant appeals, then only a different admin may decide the appeal and a second appeal is refused", async () => {
    const issue = await publishedIssue()
    const filer = await signedIn(HOST, person("banding"))
    const code = receiptCode(await complain(filer.cookie, `/isu/${issue}`))
    const version = String((await issueRow(su, issue)).version)
    await decide(first, code, {
      intent: "keep",
      reason: "no_violation",
      subjectVersion: version,
    })
    const appeal = (text: string) =>
      postForm(app, `${ORIGIN}/aduan/${code}`, filer.cookie, { appeal: text })
    const appealed = await appeal(
      "Bagian itu tetap menyebut nama lengkap warga, mohon ditinjau ulang.",
    )
    expect(appealed.status).toBe(303)
    const same = await decide(first, code, {
      intent: "keep",
      stage: "appeal",
      reason: "no_violation",
      subjectVersion: version,
    })
    expect(same.status).toBe(403)
    const other = await decide(second, code, {
      intent: "keep",
      stage: "appeal",
      reason: "no_violation",
      subjectVersion: version,
    })
    expect(other.status).toBe(303)
    const { rows } = await su.query<{
      status: string
      appeal_decided_by: string
    }>(
      "SELECT status, appeal_decided_by FROM content_complaints WHERE public_code = $1",
      [code],
    )
    expect(rows[0]).toEqual({
      status: "appeal_decided",
      appeal_decided_by: second.userId,
    })
    const again = await appeal(
      "Saya masih keberatan dan ingin banding sekali lagi untuk aduan ini.",
    )
    expect(again.status).toBe(400)
  })

  test("[AC-COMPLAINT-06] Given a complaint about a published tuntutan, when an admin hides it, then the tuntutan returns to draft with a hidden mark and leaves public view, and edit or remove are not offered", async () => {
    const tenant: DemandTenant = { id: orgId, host: HOST, campusCode: "ACCCMP" }
    const created = await createDemand(tenant, {
      fields: {
        scope: "national",
        provinceCode: null,
        regencyCode: null,
        category: "pendidikan",
        title: "Akses pendidikan dasar gratis",
        body: "Kami menuntut pendidikan dasar tanpa pungutan.",
        summary: "Pendidikan dasar tanpa pungutan di semua daerah.",
        target: "Kementerian Pendidikan",
        raisedOn: "2026-08-01",
      },
      items: ["Hapus pungutan sekolah"],
      actorId: first.userId,
    })
    if (!created.ok) throw new Error(created.reason)
    const managed = await getManagedDemand(orgId, created.code)
    await changeDemandState(tenant, {
      code: created.code,
      action: "publish",
      version: managed?.version ?? 0,
      note: null,
      actorId: first.userId,
    })
    expect(
      (await app.request(`${ORIGIN}/tuntutan/${created.code}`)).status,
    ).toBe(200)
    const filer = await signedIn(HOST, person("tuntutan"))
    const code = receiptCode(
      await complain(filer.cookie, `/tuntutan/${created.code}`, {
        part: "demand_items",
      }),
    )
    const version = String(
      (await getManagedDemand(orgId, created.code))?.version ?? 0,
    )
    const remove = await decide(first, code, {
      intent: "remove",
      reason: "standard_3",
      confirm: "yes",
      subjectVersion: version,
    })
    expect(remove.status).toBe(400)
    const hide = await decide(first, code, {
      intent: "hide",
      reason: "standard_3",
      confirm: "yes",
      subjectVersion: version,
    })
    expect(hide.status).toBe(303)
    const { rows } = await su.query<{ state: string; hidden: boolean }>(
      "SELECT state, hidden_at IS NOT NULL AS hidden FROM demands WHERE public_code = $1",
      [created.code],
    )
    expect(rows[0]).toEqual({ state: "draft", hidden: true })
    expect(
      (await app.request(`${ORIGIN}/tuntutan/${created.code}`)).status,
    ).toBe(404)
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'demand.hide' AND org_id = $1",
      [orgId],
    )
    expect(audit.rowCount).toBe(1)
  })
})
