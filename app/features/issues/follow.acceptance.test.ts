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
  issueAction,
  postForm,
  publishIssue,
  referFields,
  reportToIssue,
  submitReport,
} from "../../../e2e/staff-flows.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"

const HOST = "accfol.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let orgId = ""
let admin: Staff
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813888${String(seq).padStart(5, "0")}`,
    name: "Warga Pengikut",
  }
}

async function emailOf(userId: string): Promise<string> {
  const { rows } = await su.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  )
  return rows[0]?.email ?? ""
}

async function published(): Promise<{ issue: string; reporter: string }> {
  const owner = await signedIn(HOST, person("pelapor"))
  const { code } = await submitReport(app, HOST, owner.cookie)
  const issue = await reportToIssue(app, su, HOST, admin.cookie, code)
  await publishIssue(app, su, HOST, admin.cookie, issue)
  await mailbox().deliver(su, orgId)
  return { issue, reporter: await emailOf(owner.userId) }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  await su.query(
    `INSERT INTO regions (code, parent_code, level, name)
     VALUES ('32.04', '32', 2, 'Kabupaten Bandung') ON CONFLICT DO NOTHING`,
  )
  orgId = await insertOrg(su, "accfol")
  hostsChanged([HOST])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgId, person("admin"))
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await resetData(su)
  await su.end()
})

describe("following issues", () => {
  test("[AC-FOLLOW-01] Given a published issue, when a visitor follows it, then signing in comes first, each update is mailed once with an unfollow link, opening the link changes nothing and confirming it stops the mail", async () => {
    const { issue, reporter } = await published()
    const anonymous = await postForm(app, `${ORIGIN}/isu/${issue}`, "", {
      intent: "follow",
    })
    expect(anonymous.status).toBe(303)
    expect(anonymous.headers.get("location")).toBe(
      `/masuk?kembali=${encodeURIComponent(`/isu/${issue}`)}`,
    )
    const follower = await signedIn(HOST, person("ikut"))
    const follow = await postForm(
      app,
      `${ORIGIN}/isu/${issue}`,
      follower.cookie,
      {
        intent: "follow",
      },
    )
    expect(follow.status).toBe(303)
    const today = jakartaIsoDate(new Date())
    await issueAction(
      app,
      su,
      HOST,
      admin.cookie,
      issue,
      referFields(today, today),
    )
    const box = mailbox()
    await box.deliver(su, orgId)
    const address = await emailOf(follower.userId)
    const mails = box.sent.filter((m) => m.to === address)
    expect(mails).toHaveLength(1)
    const token = /\/berhenti\?t=([A-Za-z0-9._-]+)/.exec(
      mails[0]?.text ?? "",
    )?.[1]
    if (!token) throw new Error("no unfollow link")
    const page = await app.request(`${ORIGIN}/isu/${issue}/berhenti?t=${token}`)
    expect(page.status).toBe(200)
    expect(page.headers.get("Cache-Control")).toBe("private, no-store")
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer")
    const still = await su.query("SELECT 1 FROM follows WHERE user_id = $1", [
      follower.userId,
    ])
    expect(still.rowCount).toBe(1)
    const tampered = await postForm(
      app,
      `${ORIGIN}/isu/${issue}/berhenti`,
      "",
      { t: `${token}x` },
    )
    expect(tampered.status).toBe(200)
    expect(
      (
        await su.query("SELECT 1 FROM follows WHERE user_id = $1", [
          follower.userId,
        ])
      ).rowCount,
    ).toBe(1)
    const confirmed = await postForm(
      app,
      `${ORIGIN}/isu/${issue}/berhenti`,
      "",
      { t: token },
    )
    expect(confirmed.status).toBe(200)
    expect(await confirmed.text()).toContain(
      "Anda sudah berhenti mengikuti isu",
    )
    expect(
      (
        await su.query("SELECT 1 FROM follows WHERE user_id = $1", [
          follower.userId,
        ])
      ).rowCount,
    ).toBe(0)
    const change = await issueAction(app, su, HOST, admin.cookie, issue, {
      intent: "mark_in_progress",
      note: "",
    })
    expect(change.status).toBe(303)
    const after = mailbox()
    await after.deliver(su, orgId)
    // Reporter still follows, control
    const told = after.sent.filter((m) => m.to === reporter)
    expect(told).toHaveLength(1)
    expect(told[0]?.subject).toContain(issue)
    expect(after.sent.filter((m) => m.to === address)).toEqual([])
  })

  test("[AC-FOLLOW-02] Given published issues in two regencies, when the issue list is filtered by one regency or searched by a regency name, then only that regency's published issues show", async () => {
    const { issue: here } = await published()
    const owner = await signedIn(HOST, person("kabupaten"))
    const { code } = await submitReport(app, HOST, owner.cookie)
    const there = await reportToIssue(app, su, HOST, admin.cookie, code)
    await su.query(
      "UPDATE issues SET regency_code = '32.04' WHERE public_code = $1",
      [there],
    )
    await publishIssue(app, su, HOST, admin.cookie, there)
    const city = await (await app.request(`${ORIGIN}/isu?wilayah=32.73`)).text()
    expect(city).toContain(here)
    expect(city).not.toContain(there)
    // Canonical spelling first
    const search = await app.request(
      `${ORIGIN}/isu?q=${encodeURIComponent("Kabupaten Bandung")}`,
    )
    const target = search.status === 301 ? search.headers.get("location") : null
    const named = target
      ? await (await app.request(`${ORIGIN}${target}`)).text()
      : await search.text()
    expect(named).toContain(there)
    expect(named).not.toContain(here)
    const unknown = await app.request(`${ORIGIN}/isu?wilayah=99.99`)
    expect(unknown.status).toBe(301)
    expect(unknown.headers.get("location")).toBe("/isu")
  })
})
