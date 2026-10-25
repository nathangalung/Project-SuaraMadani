import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  listSessions,
  revokeSessions,
} from "../app/features/report/sessions.server.ts"
import { migrate } from "../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import {
  CAPTCHA_PASS,
  dropJobs,
  type FullApp,
  fullApp,
  hostsChanged,
  mailpitCode,
  routeContext,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../e2e/app-harness.ts"
import {
  issueRow,
  postForm,
  reportToIssue,
  submitReport,
} from "../e2e/staff-flows.ts"
import { AGE_CONSENT_VERSION } from "../shared/report-fields.ts"

const HOST = "accauth.localhost"
const OTHER = "accauthb.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
let app: FullApp
let orgA = ""
let orgB = ""
let restore = () => {}
let seq = 0

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62812999${String(seq).padStart(5, "0")}`,
    name: "Warga Masuk",
  }
}

function auth(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(`${ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-captcha-response": CAPTCHA_PASS,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function signUpBody(email: string, phone: string) {
  return {
    mode: "sign-up",
    name: "Warga Baru",
    email,
    phone,
    channel: "email",
  }
}

const ageBox = {
  ageDeclaration: { age_18_plus: true, ageConsentVersion: AGE_CONSENT_VERSION },
}

async function userRow(email: string) {
  const { rows } = await su.query<{
    phone_number: string | null
    email_verified: boolean
    age_declared_at: Date | null
    age_consent_version: string | null
  }>(
    `SELECT phone_number, email_verified, age_declared_at, age_consent_version
     FROM users WHERE email = $1`,
    [email],
  )
  return rows[0]
}

const get = (url: string, cookie: string) =>
  app.request(url, { headers: { cookie } })

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "accauth")
  orgB = await insertOrg(su, "accauthb")
  hostsChanged([HOST, OTHER])
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

describe("sign-up and sign-in", () => {
  test("[AC-AUTH-01] Given a new person, when they sign up with name, email, WhatsApp number, the 18+ box and the emailed code, then the account stores the declaration and gets a host-only session cookie", async () => {
    const email = `daftar.${Date.now()}@contoh.id`
    const body = signUpBody(email, "0812-3456-7801")
    const sent = await auth("/account/send-code", body)
    expect(sent.status).toBe(200)
    const code = await mailpitCode(email)
    const verified = await auth("/account/verify-code", {
      ...body,
      code,
      ...ageBox,
    })
    expect(verified.status).toBe(200)
    const cookie = verified.headers
      .getSetCookie()
      .find((one) => one.startsWith("sb.session_token="))
    expect(cookie).toBeDefined()
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Lax")
    expect(cookie).toContain("Path=/")
    expect(cookie?.toLowerCase()).not.toContain("domain=")
    expect(JSON.stringify(await verified.json())).not.toContain("token")
    const row = await userRow(email)
    expect(row?.phone_number).toBe("+6281234567801")
    expect(row?.email_verified).toBe(true)
    expect(row?.age_declared_at).toBeInstanceOf(Date)
    expect(row?.age_consent_version).toBe(AGE_CONSENT_VERSION)
  })

  test("[AC-AUTH-02] Given a sign-up without the 18+ box, a WhatsApp number or a mobile number, when it is sent, then the server refuses it and creates no account", async () => {
    const email = `tanpausia.${Date.now()}@contoh.id`
    const body = signUpBody(email, "081234567802")
    expect((await auth("/account/send-code", body)).status).toBe(200)
    const code = await mailpitCode(email)
    const noBox = await auth("/account/verify-code", { ...body, code })
    expect(noBox.status).toBe(400)
    expect(await noBox.json()).toMatchObject({
      code: "AGE_DECLARATION_REQUIRED",
    })
    expect(await userRow(email)).toBeUndefined()
    for (const phone of ["", "0801234567", "0221234567"]) {
      const res = await auth("/account/send-code", {
        ...signUpBody(`nomor.${Date.now()}@contoh.id`, phone),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: "INVALID_PHONE" })
    }
  })

  test("[AC-AUTH-03] Given a sign-in code, when three wrong codes are tried or the code has expired, then the right code no longer works", async () => {
    const account = person("salah")
    await signedIn(HOST, account)
    const body = {
      mode: "sign-in",
      identifier: account.email,
      channel: "email",
    }
    expect((await auth("/account/send-code", body)).status).toBe(200)
    const code = await mailpitCode(account.email)
    const wrong = code === "000000" ? "111111" : "000000"
    for (let i = 0; i < 3; i++) {
      const res = await auth("/account/verify-code", { ...body, code: wrong })
      expect(res.status).toBe(400)
    }
    const late = await auth("/account/verify-code", { ...body, code })
    expect(late.status).toBe(400)
    expect(late.headers.getSetCookie()).toEqual([])

    const before = new Date()
    expect((await auth("/account/send-code", body)).status).toBe(200)
    const fresh = await mailpitCode(account.email)
    // Identifier is hashed, match time
    const aged = await su.query(
      "UPDATE verifications SET expires_at = now() - interval '1 second' WHERE created_at >= $1",
      [before],
    )
    expect(aged.rowCount).toBe(1)
    const expired = await auth("/account/verify-code", { ...body, code: fresh })
    expect(expired.status).toBe(400)
    expect(expired.headers.getSetCookie()).toEqual([])
  })

  test("[AC-AUTH-04] Given a code request, when Turnstile fails or the code was sent before the account's email changed, then no code or session is given", async () => {
    const account = person("bot")
    const { userId } = await signedIn(HOST, account)
    const body = {
      mode: "sign-in",
      identifier: account.email,
      channel: "email",
    }
    const robot = await auth("/account/send-code", body, {
      "x-captcha-response": "robot",
    })
    expect(robot.status).toBe(403)
    expect(await robot.json()).toMatchObject({ code: "CAPTCHA_FAILED" })
    expect((await auth("/account/send-code", body)).status).toBe(200)
    const code = await mailpitCode(account.email)
    const moved = `pindah.${seq}@contoh.id`
    await su.query("UPDATE users SET email = $2 WHERE id = $1", [userId, moved])
    const stale = await auth("/account/verify-code", {
      ...body,
      identifier: moved,
      code,
    })
    expect(stale.status).toBe(400)
    expect(stale.headers.getSetCookie()).toEqual([])
  })

  test("[AC-AUTH-05] Given a signed-in person, when they sign out, then the session is deleted and the cookie no longer opens private pages", async () => {
    const account = person("keluar")
    const { cookie, userId } = await signedIn(HOST, account)
    const before = await get(`${ORIGIN}/lacak`, cookie)
    expect(before.status).toBe(200)
    expect(await before.text()).toContain(account.email)
    const out = await postForm(app, `${ORIGIN}/keluar`, cookie, {})
    expect(out.status).toBe(303)
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1",
      [userId],
    )
    expect(rows[0]?.n).toBe(0)
    expect((await routeContext(HOST, cookie)).session).toBeNull()
    const track = await get(`${ORIGIN}/lacak`, cookie)
    expect(track.status).toBe(200)
    expect(await track.text()).not.toContain(account.email)
  })
})

describe("code channels", () => {
  test("[AC-AUTH-11] Given WhatsApp sending is unavailable, when an account holder looks up the account and asks for a code by WhatsApp, then WhatsApp is reported unavailable and the email code still signs them in", async () => {
    const account = person("wa")
    await signedIn(HOST, account)
    const lookup = await auth("/account/lookup", { identifier: account.email })
    expect(lookup.status).toBe(200)
    expect(await lookup.json()).toMatchObject({
      found: true,
      whatsappReady: false,
    })
    const viaWhatsApp = await auth("/account/send-code", {
      mode: "sign-in",
      identifier: account.email,
      channel: "whatsapp",
    })
    expect(viaWhatsApp.status).toBe(503)
    expect(await viaWhatsApp.json()).toMatchObject({
      code: "WHATSAPP_UNAVAILABLE",
    })
    const body = {
      mode: "sign-in",
      identifier: account.email,
      channel: "email",
    }
    expect((await auth("/account/send-code", body)).status).toBe(200)
    const code = await mailpitCode(account.email)
    const verified = await auth("/account/verify-code", { ...body, code })
    expect(verified.status).toBe(200)
    expect(
      verified.headers
        .getSetCookie()
        .some((one) => one.includes("session_token=")),
    ).toBe(true)
  })
})

describe("staff and campus boundaries", () => {
  let staff: Staff

  beforeAll(async () => {
    staff = await staffSession(HOST, orgA, person("staf"))
  })

  test("[AC-AUTH-06] Given an admin without TOTP, a reporter and a TOTP-verified admin, when each opens /kelola, then only the verified admin gets in, and a staff session older than 12 hours is refused", async () => {
    const plain = await signedIn(HOST, person("tanpatotp"))
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [orgA, plain.userId],
    )
    expect((await get(`${ORIGIN}/kelola`, plain.cookie)).status).toBe(403)
    const reporter = await signedIn(HOST, person("pelapor"))
    expect((await get(`${ORIGIN}/kelola`, reporter.cookie)).status).toBe(403)
    expect((await get(`${ORIGIN}/kelola`, "")).status).toBe(403)
    const ok = await get(`${ORIGIN}/kelola`, staff.cookie)
    expect(ok.status).toBe(200)
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store")
    const old = await staffSession(HOST, orgA, person("lama"))
    await su.query(
      "UPDATE sessions SET created_at = now() - interval '13 hours' WHERE user_id = $1",
      [old.userId],
    )
    expect((await get(`${ORIGIN}/kelola`, old.cookie)).status).toBe(403)
  })

  test("[AC-AUTH-07] Given a staff session whose last code is older than 300 seconds, when the admin opens members or settings, then the server asks for the authenticator code again", async () => {
    const fresh = await get(`${ORIGIN}/kelola/anggota`, staff.cookie)
    expect(fresh.status).toBe(200)
    const stale = await staffSession(HOST, orgA, person("basi"))
    await su.query(
      `UPDATE sessions SET created_at = now() - interval '10 minutes', step_up_at = NULL
       WHERE user_id = $1`,
      [stale.userId],
    )
    // Enrolment predates the session
    await su.query(
      "UPDATE users SET updated_at = now() - interval '20 minutes' WHERE id = $1",
      [stale.userId],
    )
    for (const path of ["/kelola/anggota", "/kelola/pengaturan"]) {
      const res = await get(`${ORIGIN}${path}`, stale.cookie)
      expect(res.status).toBe(302)
      expect(res.headers.get("Location")).toBe(
        `/masuk/konfirmasi?ke=${encodeURIComponent(path)}`,
      )
    }
  })

  test("[AC-AUTH-08] Given a signed-in admin, when a form arrives from another origin or without any origin signal, then it is refused with 403 and only a same-origin request is served", async () => {
    const owner = await signedIn(HOST, person("csrf"))
    const { code } = await submitReport(app, HOST, owner.cookie)
    const send = (headers: Record<string, string>) =>
      app.request(`${ORIGIN}/kelola/laporan/${code}`, {
        method: "POST",
        headers: {
          cookie: staff.cookie,
          "content-type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body: new URLSearchParams({
          intent: "start_review",
          from: "submitted",
        }),
      })
    // React Router refuses first, 400
    const foreign = await send({ origin: "https://jahat.example" })
    expect(foreign.status).toBe(400)
    expect((await send({})).status).toBe(403)
    const { rows } = await su.query<{ status: string }>(
      "SELECT status FROM reports WHERE public_code = $1",
      [code],
    )
    expect(rows[0]?.status).toBe("submitted")
    const same = await send({ "sec-fetch-site": "same-origin" })
    expect(same.status).toBe(303)
  })

  test("[AC-AUTH-09] Given an admin of campus A, when the same session is used on campus B, then /kelola there is 403, and an admin of both campuses gets 404 for campus A's report, issue, evidence and complaint on host B", async () => {
    const b = `http://${OTHER}`
    expect((await get(`${b}/kelola`, staff.cookie)).status).toBe(403)
    const both = await staffSession(HOST, orgA, person("dua"))
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [orgB, both.userId],
    )
    const owner = await signedIn(HOST, person("milika"))
    const sent = await submitReport(app, HOST, owner.cookie, {
      evidence: [{ name: "a.png", size: 100, type: "image/png" }],
    })
    const issue = await reportToIssue(app, su, HOST, both.cookie, sent.code)
    const complaint = (
      await su.query<{ code: string }>(
        `INSERT INTO content_complaints (org_id, user_id, issue_id, public_code, submission_id, reason, part, explanation)
         VALUES ($1, $2, $3, 'ADU-ACCAUTH-26-7K3QX', gen_random_uuid(), 'hate', 'title_summary', 'Penjelasan aduan yang cukup panjang.')
         RETURNING public_code AS code`,
        [orgA, owner.userId, (await issueRow(su, HOST, issue)).id],
      )
    ).rows[0]?.code
    const own = await get(`${ORIGIN}/kelola/laporan/${sent.code}`, both.cookie)
    expect(own.status).toBe(200)
    for (const path of [
      `/kelola/laporan/${sent.code}`,
      `/kelola/isu/${issue}`,
      `/kelola/bukti/${sent.evidence[0]?.id}/asli`,
      `/kelola/aduan/${complaint}`,
    ]) {
      expect((await get(`${b}${path}`, both.cookie)).status).toBe(404)
    }
  })

  test("[AC-AUTH-10] Given the platform pages, when a non-superadmin, a superadmin without TOTP and a TOTP-verified superadmin open /admin, then only the last gets in", async () => {
    expect((await get(`${ORIGIN}/admin`, staff.cookie)).status).toBe(403)
    const flagged = await signedIn(HOST, person("superbaru"))
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [
      flagged.userId,
    ])
    expect((await get(`${ORIGIN}/admin`, flagged.cookie)).status).toBe(403)
    const owner = await staffSession(HOST, orgA, person("super"))
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [
      owner.userId,
    ])
    const ok = await get(`${ORIGIN}/admin`, owner.cookie)
    expect(ok.status).toBe(200)
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store")
  })
})

describe("active sessions", () => {
  test("[AC-AUTH-12] Given a person signed in on two devices and someone else signed in, when the person lists sessions and ends the others, then only their own sessions are listed without the address, the other device is signed out and audited, and a stale session cannot end any", async () => {
    const account = person("sesi")
    const laptop = await signedIn(HOST, account)
    const phone = await signedIn(HOST, account)
    const stranger = await signedIn(HOST, person("orang"))
    await su.query(
      "UPDATE sessions SET ip_address = '10.99.0.1' WHERE user_id = $1",
      [laptop.userId],
    )
    const { session } = await routeContext(HOST, phone.cookie)
    if (!session) throw new Error("no session")
    const listed = await listSessions(laptop.userId, session.session.id)
    expect(listed).toHaveLength(2)
    expect(listed.filter((one) => one.current)).toEqual([
      expect.objectContaining({ id: session.session.id }),
    ])
    expect(JSON.stringify(listed)).not.toContain("10.99.0.1")
    const revoke = (id: string) =>
      revokeSessions({
        orgId: orgA,
        userId: laptop.userId,
        currentSessionId: id,
        which: "others",
      })
    // Signed in 10 minutes ago
    await su.query(
      "UPDATE sessions SET created_at = now() - interval '10 minutes' WHERE id = $1",
      [session.session.id],
    )
    expect(await revoke(session.session.id)).toEqual({
      ok: false,
      reason: "stale",
    })
    // Nothing ended while stale
    expect((await routeContext(HOST, laptop.cookie)).session).not.toBeNull()
    const fresh = await signedIn(HOST, account)
    const current = (await routeContext(HOST, fresh.cookie)).session
    if (!current) throw new Error("no session")
    expect(await revoke(current.session.id)).toEqual({ ok: true, ended: 2 })
    const left = await su.query<{ user_id: string }>(
      "SELECT user_id FROM sessions WHERE user_id = ANY($1)",
      [[laptop.userId, stranger.userId]],
    )
    expect(left.rows.map((row) => row.user_id).sort()).toEqual(
      [laptop.userId, stranger.userId].sort(),
    )
    expect((await routeContext(HOST, laptop.cookie)).session).toBeNull()
    expect((await routeContext(HOST, stranger.cookie)).session).not.toBeNull()
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'session.revoke' AND actor_id = $1 AND org_id = $2",
      [laptop.userId, orgA],
    )
    expect(audit.rowCount).toBe(1)
  })
})
