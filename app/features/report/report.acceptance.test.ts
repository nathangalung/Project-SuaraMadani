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
  actionData,
  CAPTCHA_PASS,
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  loaderWith,
  mailbox,
  signedIn,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import {
  LINK_TTL_MS,
  linkKeyring,
  signLink,
  verifyLink,
} from "../../../server/signed-link.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { CONSENT_TEXT_VERSION } from "../../../shared/report-fields.ts"

const HOST = "accrep.localhost"
const OTHER = "accrepb.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
const YEAR = jakartaIsoDate(new Date()).slice(2, 4)
let app: FullApp
let orgId = ""
let restore = () => {}
let phoneSeq = 0

type Submitted = { code: string; evidence: { id: string; position: number }[] }
type Refused = { error?: string; errors?: { path: string; key: string }[] }

function account(label: string) {
  phoneSeq += 1
  return {
    email: `${label}.${phoneSeq}@contoh.id`,
    phone: `+62812555${String(phoneSeq).padStart(5, "0")}`,
    name: "Pelapor Uji",
  }
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: crypto.randomUUID(),
    turnstileToken: CAPTCHA_PASS,
    relation: { relation: "self" },
    location: {
      provinceCode: "32",
      regencyCode: "32.73",
      districtCode: "32.73.02",
    },
    details: {
      title: "Sekolah rusak di Dago",
      story:
        "Atap ruang kelas runtuh dan siswa belajar di halaman sejak sebulan lalu.",
      categoryId: "program",
      subcategoryId: "program.pendidikan",
      occurredOn: "2026-10-01",
      urgency: "medium",
    },
    impact: {
      groups: ["general_public"],
      affectedCount: "11_100",
      ongoing: "yes",
    },
    evidence: [{ name: "foto.png", size: 2048, type: "image/png" }],
    contact: { contactable: "no" },
    consent: {
      consents: {
        age_18_plus: true,
        accurate: true,
        public_issue: true,
        aggregate_processing: true,
      },
      consentTextVersion: CONSENT_TEXT_VERSION,
    },
    ...overrides,
  }
}

function submit(cookie: string, payload: unknown, host = HOST) {
  return app.request(`http://${host}/lapor/periksa.data`, {
    method: "POST",
    headers: {
      cookie,
      origin: `http://${host}`,
      "content-type": "application/json",
      "x-client-ip": "10.1.1.1",
    },
    body: JSON.stringify(payload),
  })
}

async function reportCount(userId: string): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM reports WHERE user_id = $1",
    [userId],
  )
  return rows[0]?.n ?? 0
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accrep")
  await insertOrg(su, "accrepb")
  hostsChanged([HOST, OTHER])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
})

afterAll(async () => {
  await dropJobs(su, [HOST, OTHER])
  // Later files rebuild auth
  hostsChanged([HOST, OTHER])
  restore()
  await resetData(su)
  await su.end()
})

describe("report submission", () => {
  test("[AC-REPORT-01] Given a signed-in reporter, when the complete step-7 form is sent, then the report is stored privately with its code, consent record and receipt email", async () => {
    const reporter = await signedIn(HOST, account("kirim"))
    const sentAt = Date.now()
    const res = await submit(reporter.cookie, body())
    expect(res.status).toBe(201)
    const result = await actionData<Submitted>(res)
    expect(result.code).toMatch(
      new RegExp(`^ACCREP-${YEAR}-[0-9A-HJKMNP-TV-Z]{5}$`),
    )
    expect(result.evidence).toHaveLength(1)
    const { rows } = await su.query<{
      status: string
      consents: string[]
      consent_text_version: string
      consented_at: Date
    }>(
      `SELECT status, consents, consent_text_version, created_at AS consented_at
       FROM reports WHERE public_code = $1`,
      [result.code],
    )
    expect(rows[0]?.status).toBe("submitted")
    expect(rows[0]?.consents.sort()).toEqual([
      "accurate",
      "age_18_plus",
      "aggregate_processing",
      "public_issue",
    ])
    expect(rows[0]?.consent_text_version).toBe(CONSENT_TEXT_VERSION)
    expect(rows[0]?.consented_at.getTime()).toBeGreaterThanOrEqual(
      sentAt - 1000,
    )
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'report.submit' AND actor_id = $1",
      [reporter.userId],
    )
    expect(audit.rowCount).toBe(1)
    const box = mailbox()
    await box.deliver(su, orgId)
    const receipt = box.sent.filter((m) => m.to.startsWith("kirim."))
    expect(receipt).toHaveLength(1)
    expect(receipt[0]?.text).toContain(result.code)
    // Report text stays private
    const page = await app.request(`${ORIGIN}/isu?q=Dago`)
    expect(await page.text()).not.toContain("Atap ruang kelas runtuh")
  })

  test("[AC-REPORT-02] Given a visitor who is not signed in, when the form is sent, then the server answers 401 and stores nothing", async () => {
    const before = await su.query("SELECT count(*)::int AS n FROM reports")
    const res = await submit("", body())
    expect(res.status).toBe(401)
    expect(await actionData<Refused>(res)).toEqual({
      error: "sign_in_required",
    })
    const after = await su.query("SELECT count(*)::int AS n FROM reports")
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n)
  })

  test("[AC-REPORT-03] Given the 18+ box is not ticked, when the form is sent, then the server refuses it and stores nothing", async () => {
    const reporter = await signedIn(HOST, account("usia"))
    const payload = body({
      consent: {
        consents: {
          accurate: true,
          public_issue: true,
          aggregate_processing: true,
        },
        consentTextVersion: CONSENT_TEXT_VERSION,
      },
    })
    const res = await submit(reporter.cookie, payload)
    expect(res.status).toBe(400)
    const refused = await actionData<Refused>(res)
    expect(refused.errors?.map((e) => e.key)).toContain(
      "error_consent_age_required",
    )
    expect(await reportCount(reporter.userId)).toBe(0)
  })

  test("[AC-REPORT-04] Given a future event date, six files or a file over its size limit, when the form is sent, then each is refused with a field error", async () => {
    const reporter = await signedIn(HOST, account("batas"))
    const future = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const cases: [Record<string, unknown>, string][] = [
      [
        { details: { ...body().details, occurredOn: future } },
        "error_occurred_on_future",
      ],
      [
        {
          evidence: Array.from({ length: 6 }, (_, i) => ({
            name: `f${i}.png`,
            size: 1000,
            type: "image/png",
          })),
        },
        "error_evidence_too_many",
      ],
      [
        {
          evidence: [
            {
              name: "besar.png",
              size: 10 * 1024 * 1024 + 1,
              type: "image/png",
            },
          ],
        },
        "error_evidence_too_large",
      ],
      [
        {
          evidence: [
            {
              name: "video.mp4",
              size: 50 * 1024 * 1024 + 1,
              type: "video/mp4",
            },
          ],
        },
        "error_evidence_too_large",
      ],
    ]
    for (const [overrides, key] of cases) {
      const res = await submit(reporter.cookie, body(overrides))
      expect(res.status).toBe(400)
      const refused = await actionData<Refused>(res)
      expect(refused.errors?.map((e) => e.key)).toContain(key)
    }
    expect(await reportCount(reporter.userId)).toBe(0)
  })

  test("[AC-REPORT-05] Given a report already sent, when the browser sends the same submission again, then the server answers 200 with the same code and stores one report", async () => {
    const reporter = await signedIn(HOST, account("ulang"))
    const payload = body()
    const first = await submit(reporter.cookie, payload)
    expect(first.status).toBe(201)
    const second = await submit(reporter.cookie, payload)
    expect(second.status).toBe(200)
    const a = await actionData<Submitted>(first)
    const b = await actionData<Submitted>(second)
    expect(b).toEqual(a)
    expect(await reportCount(reporter.userId)).toBe(1)
  })

  test("[AC-REPORT-06] Given a failed Turnstile check, when the form is sent, then the server answers 403 captcha_failed and stores nothing", async () => {
    const reporter = await signedIn(HOST, account("captcha"))
    const res = await submit(reporter.cookie, body({ turnstileToken: "robot" }))
    expect(res.status).toBe(403)
    expect(await actionData<Refused>(res)).toEqual({ error: "captcha_failed" })
    expect(await reportCount(reporter.userId)).toBe(0)
  })

  test("[AC-REPORT-07] Given a reporter who agrees to be contacted, when the report is sent, then the account's proven number is copied to the private contact table, and an account without a number cannot agree", async () => {
    const reporter = await signedIn(HOST, account("kontak"))
    await su.query("UPDATE users SET phone_verified = true WHERE id = $1", [
      reporter.userId,
    ])
    const yes = await submit(
      reporter.cookie,
      body({ contact: { contactable: "yes", method: "whatsapp" } }),
    )
    expect(yes.status).toBe(201)
    const { code } = await actionData<Submitted>(yes)
    const { rows } = await su.query<{ phone: string; method: string }>(
      `SELECT c.phone, c.method FROM report_contacts c
       JOIN reports r ON r.id = c.report_id WHERE r.public_code = $1`,
      [code],
    )
    const own = await su.query<{ phone_number: string }>(
      "SELECT phone_number FROM users WHERE id = $1",
      [reporter.userId],
    )
    expect(rows).toEqual([
      { phone: own.rows[0]?.phone_number ?? "", method: "whatsapp" },
    ])
    const bare = await signedIn(HOST, account("tanpanomor"))
    await su.query(
      "UPDATE users SET phone_number = NULL, phone_verified = false WHERE id = $1",
      [bare.userId],
    )
    const refused = await submit(
      bare.cookie,
      body({ contact: { contactable: "yes", method: "whatsapp" } }),
    )
    expect(refused.status).toBe(400)
    expect(
      (await actionData<Refused>(refused)).errors?.map((e) => e.key),
    ).toEqual(["error_contact_no_phone"])
    expect(await reportCount(bare.userId)).toBe(0)
  })

  test("[AC-REPORT-08] Given a campus that paused intake, when a report is sent, then the server answers 503 intake_paused", async () => {
    const reporter = await signedIn(HOST, account("jeda"))
    await su.query(
      `UPDATE organizations SET settings = settings || '{"intakePaused": true}' WHERE id = $1`,
      [orgId],
    )
    hostsChanged([HOST])
    try {
      const res = await submit(reporter.cookie, body())
      expect(res.status).toBe(503)
      expect(await actionData<Refused>(res)).toEqual({
        error: "intake_paused",
      })
      expect(await reportCount(reporter.userId)).toBe(0)
    } finally {
      await su.query(
        "UPDATE organizations SET settings = settings - 'intakePaused' WHERE id = $1",
        [orgId],
      )
      hostsChanged([HOST])
    }
  })

  test("[AC-REPORT-09] Given a reporter who sent five reports in 24 hours, when a sixth is sent, then the server answers 429 quota_exceeded", async () => {
    const reporter = await signedIn(HOST, account("kuota"))
    for (let i = 0; i < 5; i++) {
      expect((await submit(reporter.cookie, body())).status).toBe(201)
    }
    const res = await submit(reporter.cookie, body())
    expect(res.status).toBe(429)
    expect(await actionData<Refused>(res)).toEqual({ error: "quota_exceeded" })
    expect(await reportCount(reporter.userId)).toBe(5)
  })

  test("[AC-REPORT-10] Given a report code, when its success page is opened on another campus or with a code never sent, then the page answers 404", async () => {
    const reporter = await signedIn(HOST, account("sukses"))
    const { code } = await actionData<Submitted>(
      await submit(reporter.cookie, body()),
    )
    const own = await app.request(`${ORIGIN}/lapor/sukses/${code}`)
    expect(own.status).toBe(200)
    expect(await own.text()).toContain(code)
    const elsewhere = await app.request(`http://${OTHER}/lapor/sukses/${code}`)
    expect(elsewhere.status).toBe(404)
    const unsent = await app.request(`${ORIGIN}/lapor/sukses/ACCREP-26-00000`)
    expect(unsent.status).toBe(404)
  })

  test("[AC-REPORT-11] Given the receipt email's tracking link, when it is opened signed out, then it shows that report privately, and a tampered or expired link shows nothing", async () => {
    const reporter = await signedIn(HOST, account("lacak"))
    const { code } = await actionData<Submitted>(
      await submit(reporter.cookie, body()),
    )
    const sentAt = new Date()
    const box = mailbox(() => sentAt)
    await box.deliver(su, orgId)
    const mail = box.sent.find((m) => m.text.includes(code))
    const link = /https?:\/\/[^\s]+\/lacak\?t=[A-Za-z0-9._-]+/.exec(
      mail?.text ?? "",
    )?.[0]
    if (!link) throw new Error("no tracking link in the receipt")
    const token = new URL(link).searchParams.get("t") ?? ""
    const open = await app.request(`${ORIGIN}/lacak?t=${token}`)
    expect(open.status).toBe(200)
    expect(open.headers.get("Cache-Control")).toBe("private, no-store")
    expect(open.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(await open.text()).toContain(code)
    // Valid 30 days from sending
    const at = (ms: number) => ({
      purpose: "lacak" as const,
      orgId,
      now: new Date(sentAt.getTime() + ms),
    })
    expect(verifyLink(linkKeyring(), token, at(LINK_TTL_MS - 1000))).not.toBe(
      null,
    )
    expect(verifyLink(linkKeyring(), token, at(LINK_TTL_MS))).toBeNull()
    const nothing = async (t: string) => {
      const res = await app.request(`${ORIGIN}/lacak.data?t=${t}`)
      expect(res.status).toBe(200)
      const page = await loaderWith<{ link: string; own: unknown }>(res, "link")
      expect(page).toMatchObject({ link: "invalid", own: null })
    }
    const tampered = `${token.slice(0, -2)}${token.endsWith("A") ? "BB" : "AA"}`
    await nothing(tampered)
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM reports WHERE public_code = $1",
      [code],
    )
    const expired = signLink(linkKeyring(), {
      purpose: "lacak",
      orgId,
      subjectId: rows[0]?.id ?? "",
      userId: reporter.userId,
      expiresAt: new Date(Date.now() - 1000),
    })
    await nothing(expired)
  })

  test("[AC-REPORT-12] Given the dashboard snapshot counts the review queue, when it reaches 50 reports, then /lacak and the report form say review is slower than usual, and below 50 they do not", async () => {
    const reporter = await signedIn(HOST, account("antre"))
    const snapshot = (queue: number) =>
      su.query(
        `INSERT INTO dashboard_snapshots (org_id, data, computed_at)
         VALUES ($1, $2, now())
         ON CONFLICT (org_id) DO UPDATE SET data = excluded.data, computed_at = excluded.computed_at`,
        [orgId, JSON.stringify({ reports: { queue } })],
      )
    // PLAN 5.10 quotes this note
    const note = "Pemeriksaan lebih lama dari biasanya."
    const form = async () =>
      (
        await loaderWith<{ slow: boolean }>(
          await app.request(`${ORIGIN}/lapor.data`),
          "slow",
        )
      ).slow
    await snapshot(49)
    const calm = await app.request(`${ORIGIN}/lacak`, {
      headers: { cookie: reporter.cookie },
    })
    expect(await calm.text()).not.toContain(note)
    expect(await form()).toBe(false)
    await snapshot(50)
    const busy = await app.request(`${ORIGIN}/lacak`, {
      headers: { cookie: reporter.cookie },
    })
    expect(await busy.text()).toContain(note)
    expect(await form()).toBe(true)
    await su.query("DELETE FROM dashboard_snapshots WHERE org_id = $1", [orgId])
  })
})
