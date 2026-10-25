import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import sharp from "sharp"
import { schema } from "../../../db/client.server.ts"
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
  mailbox,
  queued,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import {
  CHECKLIST,
  issueAction,
  issueRow,
  postForm,
  publishIssue,
  referFields,
  reportStatus,
  reportToDraftIssue,
  reportToIssue,
  review,
  submitReport,
} from "../../../e2e/staff-flows.ts"
import { defaultFilesDir, originalPath } from "../../../server/files.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { createEvidenceHandler } from "../../../worker/evidence.ts"

const HOST = "accmod.localhost"
const OTHER = "accmodb.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
// worker-media role, real grants
const mediaPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sb_media",
})
let app: FullApp
let orgA = ""
let orgB = ""
let adminA: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62812777${String(seq).padStart(5, "0")}`,
    name: `Warga ${label}`,
  }
}

async function reporter(label: string) {
  return signedIn(HOST, person(label))
}

async function emailOf(userId: string): Promise<string> {
  const { rows } = await su.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  )
  return rows[0]?.email ?? ""
}

const NEW_ISSUE = {
  target: "new",
  title: "Lampu jalan padam di Coblong",
  summary: "Lampu jalan di jalan utama Coblong padam sejak dua minggu.",
}

const today = () => jakartaIsoDate(new Date())
const inDays = (days: number) =>
  jakartaIsoDate(new Date(Date.now() + days * 86_400_000))

async function mailTo(
  email: string,
): Promise<{ subject: string; text: string; html: string }[]> {
  const box = mailbox()
  await box.deliver(su, orgA)
  await box.deliver(su, orgB)
  return box.sent.filter((m) => m.to === email)
}

async function publishedIssue(label: string) {
  const owner = await reporter(label)
  const { code } = await submitReport(app, HOST, owner.cookie)
  const issue = await reportToIssue(app, su, HOST, adminA.cookie, code)
  return { owner, report: code, issue }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "accmod")
  orgB = await insertOrg(su, "accmodb")
  hostsChanged([HOST, OTHER])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  adminA = await staffSession(HOST, orgA, person("admina"))
})

afterAll(async () => {
  await dropJobs(su, [HOST, OTHER])
  // Later files rebuild auth
  hostsChanged([HOST, OTHER])
  restore()
  for (const org of [orgA, orgB]) {
    await rm(dirname(originalPath(defaultFilesDir(), org, "x")), {
      recursive: true,
      force: true,
    })
    // AC-MOD-11 derives a WebP
    await rm(join(resolve(defaultFilesDir()), "derived", org), {
      recursive: true,
      force: true,
    })
  }
  await resetData(su)
  await mediaPool.end()
  await su.end()
})

describe("report review", () => {
  test("[AC-MOD-01] Given a new report, when an admin verifies it into a new issue with the full checklist, then in one step the report is merged into a published issue and the reporter gets one email, while the removed review step, a partial checklist and a stale decision are refused", async () => {
    const owner = await reporter("tinjau")
    const { code } = await submitReport(app, HOST, owner.cookie)
    const email = await emailOf(owner.userId)
    await mailTo(email)
    // Review step removed 25 Oct
    const started = await review(app, su, HOST, adminA.cookie, code, {
      intent: "start_review",
    })
    expect(started.status).toBe(400)
    const partial = await review(app, su, HOST, adminA.cookie, code, {
      intent: "verify",
      method: "site_photo",
      ...NEW_ISSUE,
      checklist: CHECKLIST.slice(0, 3),
    })
    expect(partial.status).toBe(400)
    expect(await reportStatus(su, HOST, code)).toBe("submitted")
    const verified = await review(app, su, HOST, adminA.cookie, code, {
      intent: "verify",
      method: "site_photo",
      ...NEW_ISSUE,
      checklist: CHECKLIST,
    })
    expect(verified.status).toBe(303)
    const issue = /\/kelola\/isu\/([^/#?]+)/.exec(
      verified.headers.get("location") ?? "",
    )?.[1]
    expect(await reportStatus(su, HOST, code)).toBe("merged")
    expect((await app.request(`${ORIGIN}/isu/${issue}`)).status).toBe(200)
    const mails = await mailTo(email)
    expect(mails).toHaveLength(1)
    expect(mails[0]?.text).toContain(code)
    const stale = await postForm(
      app,
      `${ORIGIN}/kelola/laporan/${code}`,
      adminA.cookie,
      {
        intent: "verify",
        from: "submitted",
        method: "site_photo",
        ...NEW_ISSUE,
        checklist: CHECKLIST,
      },
    )
    expect(stale.status).toBe(409)
  })

  test("[AC-MOD-02] Given a new report, when an admin marks it unverifiable with a free-text reason, then the decision is audited without its text, the reporter reads that reason safely by email and on /lacak with no reason code or standard link, a short or blank reason is refused, and a rejection is no longer accepted", async () => {
    const owner = await reporter("tolak")
    const { code } = await submitReport(app, HOST, owner.cookie)
    for (const reasonText of ["pendek", " ".repeat(30)]) {
      const short = await review(app, su, HOST, adminA.cookie, code, {
        intent: "mark_unverifiable",
        reasonText,
      })
      expect(short.status).toBe(400)
    }
    // Reject form removed 25 Oct
    const rejected = await review(app, su, HOST, adminA.cookie, code, {
      intent: "reject",
      reason: "standard_2",
      reasonText: "Laporan ini menuduh orang yang bisa dikenali tanpa bukti.",
    })
    expect(rejected.status).toBe(400)
    expect(await reportStatus(su, HOST, code)).toBe("submitted")
    const reasonText =
      "Lokasi “Jl. Dago” <b>belum</b> bisa kami pastikan & fotonya buram."
    const decided = await review(app, su, HOST, adminA.cookie, code, {
      intent: "mark_unverifiable",
      reasonText,
    })
    expect(decided.status).toBe(303)
    expect(await reportStatus(su, HOST, code)).toBe("unverifiable")
    const { rows } = await su.query<{
      reason_code: string | null
      reason_text: string
      decided_by: string
    }>(
      `SELECT d.reason_code, d.reason_text, d.decided_by FROM moderation_decisions d
       JOIN reports r ON r.id = d.report_id WHERE r.public_code = $1`,
      [code],
    )
    expect(rows).toEqual([
      { reason_code: null, reason_text: reasonText, decided_by: adminA.userId },
    ])
    // Audited, text stays redactable
    const audit = await su.query<{ reason_code: string | null; row: string }>(
      `SELECT a.reason_code, row_to_json(a)::text AS row FROM audit_log a
       JOIN reports r ON r.id = a.entity_id
       WHERE a.action = 'report.mark_unverifiable' AND r.public_code = $1`,
      [code],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.reason_code).toBeNull()
    expect(audit.rows[0]?.row).not.toContain("fotonya buram")
    const mail = (await mailTo(await emailOf(owner.userId))).find((m) =>
      m.text.includes("fotonya buram"),
    )
    expect(mail?.text).toContain(reasonText)
    expect(mail?.html).toContain("&lt;b&gt;belum&lt;/b&gt;")
    expect(mail?.html).not.toContain("<b>belum")
    expect(mail?.text).not.toContain("/pedoman#standar")
    const track = await app.request(`${ORIGIN}/lacak`, {
      headers: { cookie: owner.cookie },
    })
    expect(track.status).toBe(200)
    expect(track.headers.get("Cache-Control")).toBe("private, no-store")
    const page = await track.text()
    expect(page).toContain("&lt;b&gt;belum&lt;/b&gt;")
    expect(page).not.toContain("<b>belum")
  })
})

describe("issues", () => {
  test("[AC-MOD-03] Given a verified report from before 25 Oct, when an admin merges it into a new issue, then the issue stays private until published and the reporter follows it, and a closed issue cannot take a newly verified report", async () => {
    const owner = await reporter("gabung")
    const { code } = await submitReport(app, HOST, owner.cookie)
    const issue = await reportToDraftIssue(app, su, HOST, adminA.cookie, code)
    expect(await reportStatus(su, HOST, code)).toBe("merged")
    expect((await app.request(`${ORIGIN}/isu/${issue}`)).status).toBe(404)
    const follows = await su.query(
      "SELECT 1 FROM follows f JOIN issues i ON i.id = f.issue_id WHERE i.public_code = $1 AND f.user_id = $2",
      [issue, owner.userId],
    )
    expect(follows.rowCount).toBe(1)
    await publishIssue(app, su, HOST, adminA.cookie, issue)
    const closed = await issueAction(app, su, HOST, adminA.cookie, issue, {
      intent: "close",
      note: "Ditutup karena sudah ditangani lewat jalur lain.",
    })
    expect(closed.status).toBe(303)
    const late = await reporter("telat")
    const next = await submitReport(app, HOST, late.cookie)
    const { id } = await issueRow(su, HOST, issue)
    const refused = await review(app, su, HOST, adminA.cookie, next.code, {
      intent: "verify",
      method: "document",
      target: "existing",
      issueId: id,
    })
    // Closed issue is no target
    expect(refused.status).toBe(400)
    expect(await reportStatus(su, HOST, next.code)).toBe("submitted")
  })

  test("[AC-MOD-04] Given an unpublished issue, when an admin publishes it with the full checklist, then it becomes public without emailing its followers, and a partial checklist is refused", async () => {
    const owner = await reporter("terbit")
    const { code } = await submitReport(app, HOST, owner.cookie)
    const issue = await reportToDraftIssue(app, su, HOST, adminA.cookie, code)
    const { id } = await issueRow(su, HOST, issue)
    const email = await emailOf(owner.userId)
    // Merge mail out
    await mailTo(email)
    const partial = await postForm(
      app,
      `${ORIGIN}/kelola/isu/${issue}`,
      adminA.cookie,
      { intent: "publish", issueId: id, checklist: ["no_personal_data"] },
    )
    expect(partial.status).toBe(400)
    expect((await app.request(`${ORIGIN}/isu/${issue}`)).status).toBe(404)
    const published = await publishIssue(app, su, HOST, adminA.cookie, issue)
    expect(published.status).toBe(303)
    const page = await app.request(`${ORIGIN}/isu/${issue}`)
    expect(page.status).toBe(200)
    const list = await (await app.request(`${ORIGIN}/isu`)).text()
    expect(list).toContain(issue)
    // Follower emails removed 25 Oct
    expect(await mailTo(email)).toEqual([])
  })

  test("[AC-MOD-05] Given a published issue, when an admin refers, escalates, re-refers and records a response, then each step follows the two-axis state machine, needs an http(s) source and refuses a stale version", async () => {
    const { issue } = await publishedIssue("teruskan")
    const refer = await issueAction(
      app,
      su,
      HOST,
      adminA.cookie,
      issue,
      referFields(today(), inDays(14)),
    )
    expect(refer.status).toBe(303)
    let row = await issueRow(su, HOST, issue)
    expect([row.advocacy_status, row.gov_status]).toEqual([
      "referred",
      "awaiting_response",
    ])
    const escalate = await issueAction(app, su, HOST, adminA.cookie, issue, {
      intent: "escalate",
      agency: "Ombudsman RI Perwakilan Jawa Barat",
      channel: "ombudsman",
      ticket: "",
      sentOn: today(),
      deadlineOn: "",
    })
    expect(escalate.status).toBe(303)
    await issueAction(app, su, HOST, adminA.cookie, issue, {
      intent: "mark_not_competent",
      note: "",
    })
    const again = await issueAction(
      app,
      su,
      HOST,
      adminA.cookie,
      issue,
      referFields(today(), inDays(14)),
    )
    expect(again.status).toBe(303)
    row = await issueRow(su, HOST, issue)
    expect([row.advocacy_status, row.gov_status]).toEqual([
      "escalated",
      "awaiting_response",
    ])
    const script = await issueAction(app, su, HOST, adminA.cookie, issue, {
      intent: "record_response",
      responseAgency: "Dinas PU Kota Bandung",
      body: "Perbaikan lampu dijadwalkan pekan depan oleh dinas.",
      respondedOn: today(),
      sourceUrl: "javascript:alert(1)",
    })
    expect(script.status).toBe(400)
    const stale = await postForm(
      app,
      `${ORIGIN}/kelola/isu/${issue}`,
      adminA.cookie,
      {
        intent: "record_response",
        advocacy: row.advocacy_status,
        government: row.gov_status,
        version: String(row.version - 1),
        responseAgency: "Dinas PU Kota Bandung",
        body: "Perbaikan lampu dijadwalkan pekan depan oleh dinas.",
        respondedOn: today(),
        sourceUrl: "https://pu.bandung.go.id/berita/2",
      },
    )
    expect(stale.status).toBe(409)
    const recorded = await issueAction(app, su, HOST, adminA.cookie, issue, {
      intent: "record_response",
      responseAgency: "Dinas PU Kota Bandung",
      body: "Perbaikan lampu dijadwalkan pekan depan oleh dinas.",
      respondedOn: today(),
      sourceUrl: "https://pu.bandung.go.id/berita/2",
    })
    expect(recorded.status).toBe(303)
    expect((await issueRow(su, HOST, issue)).gov_status).toBe("responded")
    const json = await (
      await app.request(`${ORIGIN}/api/v1/isu/${issue}`)
    ).json()
    expect(json.issue.responses[0]).toMatchObject({
      body: "Perbaikan lampu dijadwalkan pekan depan oleh dinas.",
      sourceUrl: "https://pu.bandung.go.id/berita/2",
    })
  })

  test("[AC-MOD-06] Given a report whose reporter agreed to be contacted, when an admin opens the contact, then the number is shown privately and the view is audited", async () => {
    const owner = await reporter("hubungi")
    await su.query("UPDATE users SET phone_verified = true WHERE id = $1", [
      owner.userId,
    ])
    const { code } = await submitReport(app, HOST, owner.cookie, {
      contact: { contactable: "yes", method: "whatsapp" },
    })
    const res = await app.request(`${ORIGIN}/kelola/laporan/${code}.data`, {
      method: "POST",
      headers: {
        cookie: adminA.cookie,
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ intent: "show_contact" }),
    })
    expect(res.status).toBe(200)
    const phone = (
      await su.query<{ phone_number: string }>(
        "SELECT phone_number FROM users WHERE id = $1",
        [owner.userId],
      )
    ).rows[0]?.phone_number
    expect(await res.text()).toContain(phone ?? "missing")
    const audit = await su.query<{ actor_id: string }>(
      `SELECT a.actor_id FROM audit_log a JOIN reports r ON r.id = a.entity_id
       WHERE a.action = 'report.view_contact' AND r.public_code = $1`,
      [code],
    )
    expect(audit.rows).toEqual([{ actor_id: adminA.userId }])
    const page = await app.request(`${ORIGIN}/kelola/laporan/${code}`, {
      headers: { cookie: adminA.cookie },
    })
    expect(page.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await page.text()).not.toContain(phone ?? "missing")
  })

  test("[AC-MOD-07] Given a report about another campus, when an admin posts the removed forward action, then it is refused, the report stays where it is and the other campus gets no copy", async () => {
    const owner = await reporter("terus")
    const sent = await submitReport(app, HOST, owner.cookie)
    // Forwarding removed 25 Oct
    const res = await postForm(
      app,
      `${ORIGIN}/kelola/laporan/${sent.code}`,
      adminA.cookie,
      { intent: "forward", from: "submitted", targetOrgId: orgB },
    )
    expect(res.status).toBe(400)
    expect(await reportStatus(su, HOST, sent.code)).toBe("submitted")
    const copies = await su.query(
      "SELECT 1 FROM reports WHERE org_id = $1 AND forwarded_from_report_id IS NOT NULL",
      [orgB],
    )
    expect(copies.rowCount).toBe(0)
    const audits = await su.query(
      "SELECT 1 FROM audit_log WHERE action LIKE 'report.forward%'",
    )
    expect(audits.rowCount).toBe(0)
  })

  test("[AC-MOD-08] Given a published issue, when an admin edits its title, then the public page shows the new title and the audit log holds only column names and hashes", async () => {
    const { issue } = await publishedIssue("sunting")
    const row = await issueRow(su, HOST, issue)
    const title = "Penerangan jalan mati di Coblong"
    const edited = await postForm(
      app,
      `${ORIGIN}/kelola/isu/${issue}`,
      adminA.cookie,
      {
        intent: "edit",
        title,
        summary: "Lampu jalan di jalan utama Coblong padam sejak dua minggu.",
        subcategoryId: "program.infrastruktur",
        regencyCode: "32.73",
        version: String(row.version),
      },
    )
    expect(edited.status).toBe(303)
    expect(
      await (await app.request(`${ORIGIN}/isu/${issue}`)).text(),
    ).toContain(title)
    const audit = await su.query<{
      changed_columns: string[]
      row: string
    }>(
      `SELECT changed_columns, row_to_json(a)::text AS row FROM audit_log a
       WHERE action = 'issue.edit' AND entity_id = $1`,
      [row.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]?.changed_columns).toEqual(["title"])
    expect(audit.rows[0]?.row).not.toContain(title)
    const stale = await postForm(
      app,
      `${ORIGIN}/kelola/isu/${issue}`,
      adminA.cookie,
      {
        intent: "edit",
        title: "Judul lain yang cukup panjang",
        summary: "Lampu jalan di jalan utama Coblong padam sejak dua minggu.",
        subcategoryId: "program.infrastruktur",
        regencyCode: "32.73",
        version: String(row.version),
      },
    )
    expect(stale.status).toBe(409)
  })

  test("[AC-MOD-09] Given a published issue and a Komdigi order, when an admin removes it under the legal panel, then the page answers 410 with the reason, a takedown job is queued and followers get no email", async () => {
    const { issue, owner } = await publishedIssue("hukum")
    const row = await issueRow(su, HOST, issue)
    const email = (
      await su.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [owner.userId],
      )
    ).rows[0]?.email
    // Verify mail already out
    await mailTo(email ?? "")
    const res = await postForm(
      app,
      `${ORIGIN}/kelola/isu/${issue}`,
      adminA.cookie,
      {
        intent: "legal_takedown",
        decision: "remove",
        reason: "komdigi_order",
        confirm: "yes",
        version: String(row.version),
      },
    )
    expect(res.status).toBe(303)
    const page = await app.request(`${ORIGIN}/isu/${issue}`)
    expect(page.status).toBe(410)
    expect(page.headers.get("Cache-Control")).toBe("no-store")
    expect(await page.text()).toContain('href="/pedoman"')
    const takedown = await su.query<{ id: string }>(
      "SELECT id FROM takedowns WHERE issue_id = $1",
      [row.id],
    )
    expect(takedown.rows).toHaveLength(1)
    const jobs = await queued<{ orgId: string; takedownId: string }>(
      su,
      "takedown",
      orgA,
    )
    const mine = jobs.filter(
      (job) => job.data.takedownId === takedown.rows[0]?.id,
    )
    expect(mine).toHaveLength(1)
    expect(await mailTo(email ?? "")).toEqual([])
  })
})

describe("accounts and evidence", () => {
  test("[AC-MOD-10] Given a reporter who asks for deletion, when an admin closes the account at that campus, then the membership, reports and sessions are gone and it is audited, but a staff account cannot be closed", async () => {
    const account = person("tutup")
    const owner = await signedIn(HOST, account)
    const { code } = await submitReport(app, HOST, owner.cookie)
    const res = await postForm(
      app,
      `${ORIGIN}/kelola/laporan/${code}/tutup-akun.data`,
      adminA.cookie,
      { reason: "data_subject_request", confirm: "yes" },
    )
    expect(res.status).toBe(200)
    const done = await actionData<{ done: { reports: number } }>(res)
    expect(done.done.reports).toBe(1)
    const left = await su.query(
      `SELECT (SELECT count(*)::int FROM members WHERE user_id = $1 AND organization_id = $2) AS members,
              (SELECT count(*)::int FROM reports WHERE user_id = $1 AND org_id = $2) AS reports,
              (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS sessions`,
      [owner.userId, orgA],
    )
    expect(left.rows[0]).toEqual({ members: 0, reports: 0, sessions: 0 })
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'account.close' AND org_id = $1",
      [orgA],
    )
    expect(audit.rowCount).toBe(1)
    // Same account signs in again
    const again = await signedIn(HOST, account)
    expect(again.userId).toBe(owner.userId)
    const track = await app.request(`${ORIGIN}/lacak.data`, {
      headers: { cookie: again.cookie },
    })
    expect(track.status).toBe(200)
    const listed = await loaderWith<{ own: { reports: unknown[] } }>(
      track,
      "own",
    )
    expect(listed.own.reports).toEqual([])
    // Staff elsewhere reports here
    const staffer = await reporter("staflain")
    const staffCode = (await submitReport(app, HOST, staffer.cookie)).code
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [orgB, staffer.userId],
    )
    const refused = await postForm(
      app,
      `${ORIGIN}/kelola/laporan/${staffCode}/tutup-akun.data`,
      adminA.cookie,
      { reason: "data_subject_request", confirm: "yes" },
    )
    expect(refused.status).toBe(403)
  })

  test("[AC-MOD-11] Given an uploaded photo, when an admin downloads the original before and after the ClamAV scan, then it is refused until clean and then sent as an audited attachment that cannot run", async () => {
    const owner = await reporter("asli")
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#aa3300" },
    })
      .png()
      .toBuffer()
    const sent = await submitReport(app, HOST, owner.cookie, {
      evidence: [
        { name: "foto saya.PDF.jpg", size: png.length, type: "image/png" },
      ],
    })
    const id = sent.evidence[0]?.id ?? ""
    await app.request(`${ORIGIN}/api/upload/${id}`, {
      method: "POST",
      headers: { cookie: owner.cookie, origin: ORIGIN },
      body: png,
    })
    const url = `${ORIGIN}/kelola/bukti/${id}/asli`
    const before = await app.request(url, {
      headers: { cookie: adminA.cookie },
    })
    expect(before.status).toBe(404)
    const process = createEvidenceHandler({
      filesDir: defaultFilesDir(),
      db: drizzle({ client: mediaPool, schema }),
    })
    expect(await process({ orgId: orgA, evidenceId: id })).toBe("ready")
    const after = await app.request(url, { headers: { cookie: adminA.cookie } })
    expect(after.status).toBe(200)
    expect(after.headers.get("Content-Disposition")).toStartWith(
      'attachment; filename="foto saya_PDF.png"',
    )
    expect(after.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(after.headers.get("Content-Security-Policy")).toContain("sandbox")
    expect(Buffer.from(await after.arrayBuffer()).equals(png)).toBe(true)
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'evidence.download_original' AND entity_id = $1",
      [id],
    )
    expect(audit.rowCount).toBe(1)
    const reporterTry = await app.request(url, {
      headers: { cookie: owner.cookie },
    })
    expect(reporterTry.status).toBe(403)
  })

  test("[AC-MOD-12] Given staff actions, when an admin opens the audit log, then they are listed, and the database refuses to change or delete an audit row", async () => {
    const owner = await reporter("jejak")
    const { code } = await submitReport(app, HOST, owner.cookie)
    const page = await app.request(
      `${ORIGIN}/kelola/audit?tindakan=report.submit`,
      { headers: { cookie: adminA.cookie } },
    )
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`href="/kelola/laporan/${code}"`)
    const refused = {
      code: "42501",
      message: "permission denied for table audit_log",
    }
    const app_ = new Pool({ connectionString: testUrl("TEST_DATABASE_URL") })
    try {
      const client = await app_.connect()
      try {
        await client.query("BEGIN")
        await client.query("SELECT set_config('app.org_id', $1, true)", [orgA])
        await expect(
          client.query("UPDATE audit_log SET action = 'x'"),
        ).rejects.toMatchObject(refused)
        await client.query("ROLLBACK")
        await client.query("BEGIN")
        await client.query("SELECT set_config('app.org_id', $1, true)", [orgA])
        await expect(
          client.query("DELETE FROM audit_log"),
        ).rejects.toMatchObject(refused)
        await client.query("ROLLBACK")
      } finally {
        client.release()
      }
    } finally {
      await app_.end()
    }
  })

  test("[AC-MOD-13] Given published issues in the report's regency, another regency and a closed one, when an admin opens a new report, then verify targets list the same regency first, never the closed issue, and the search finds others by code", async () => {
    await su.query(
      `INSERT INTO regions (code, parent_code, level, name)
       VALUES ('32.04', '32', 2, 'Kabupaten Bandung') ON CONFLICT DO NOTHING`,
    )
    const near = (await publishedIssue("dekat")).issue
    const far = (await publishedIssue("jauh")).issue
    await su.query(
      "UPDATE issues SET regency_code = '32.04' WHERE public_code = $1",
      [far],
    )
    const closed = (await publishedIssue("tutupisu")).issue
    await issueAction(app, su, HOST, adminA.cookie, closed, {
      intent: "close",
      note: "Ditutup karena sudah ditangani lewat jalur lain.",
    })
    const owner = await reporter("sarang")
    const { code } = await submitReport(app, HOST, owner.cookie)
    const page = await (
      await app.request(`${ORIGIN}/kelola/laporan/${code}`, {
        headers: { cookie: adminA.cookie },
      })
    ).text()
    // Merge target option labels
    const options = [...page.matchAll(/<option value="[^"]+">([^<]*)</g)]
      .map((match) => match[1] ?? "")
      .filter((text) => text.startsWith("ISU-"))
    const nearAt = options.findIndex((text) => text.startsWith(near))
    const farAt = options.findIndex((text) => text.startsWith(far))
    expect(nearAt).toBeGreaterThan(-1)
    expect(farAt).toBeGreaterThan(nearAt)
    expect(options[nearAt]).toEndWith("kab/kota sama")
    expect(options[farAt]).not.toContain("kab/kota sama")
    expect(page).not.toContain(closed)
    const search = await (
      await app.request(`${ORIGIN}/kelola/laporan/${code}?cari=${far}`, {
        headers: { cookie: adminA.cookie },
      })
    ).text()
    expect(search).toContain(far)
  })
})
