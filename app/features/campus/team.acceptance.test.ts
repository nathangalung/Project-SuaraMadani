import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import sharp from "sharp"
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
  mailpitText,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import { postForm, reportPayload } from "../../../e2e/staff-flows.ts"

const HOST = "accteam.localhost"
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
    email: `${label}.${seq}.${Date.now()}@contoh.id`,
    phone: `+62813555${String(seq).padStart(5, "0")}`,
    name: "Admin Tim",
  }
}

type Notice = { notice?: string; errors?: string[] }

async function team(staff: Staff, fields: Record<string, string>) {
  const res = await postForm(
    app,
    `${ORIGIN}/kelola/anggota.data`,
    staff.cookie,
    fields,
  )
  return actionData<Notice>(res)
}

async function settings(staff: Staff, fields: Record<string, string>) {
  const res = await postForm(
    app,
    `${ORIGIN}/kelola/pengaturan.data`,
    staff.cookie,
    fields,
  )
  return actionData<Record<string, unknown>>(res)
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accteam")
  hostsChanged([HOST])
  await su.query("DELETE FROM email_log")
  restore = stubTurnstile()
  app = await fullApp()
  admin = await staffSession(HOST, orgId, person("utama"))
})

afterAll(async () => {
  await dropJobs(su, [HOST])
  // Later files rebuild auth
  hostsChanged([HOST])
  restore()
  await su.query("DELETE FROM email_log")
  await resetData(su)
  await su.end()
})

describe("team and settings", () => {
  test("[AC-TEAM-01] Given a fresh admin session, when an admin invites a colleague, then a 7-day invitation is mailed, only the invited address can accept it, and accepting leads to TOTP enrolment before /kelola opens", async () => {
    const invitee = person("undang")
    const res = await team(admin, { intent: "invite", email: invitee.email })
    expect(res.notice).toBe("invited")
    const { rows } = await su.query<{ id: string; expires_at: Date }>(
      "SELECT id, expires_at FROM invitations WHERE email = $1",
      [invitee.email.toLowerCase()],
    )
    const invitation = rows[0]
    if (!invitation) throw new Error("no invitation")
    const days = (invitation.expires_at.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.99)
    expect(days).toBeLessThan(7.01)
    const mail = await mailpitText(invitee.email)
    expect(mail).toContain(`${ORIGIN}/undangan/${invitation.id}`)
    const stranger = await signedIn(HOST, person("asing"))
    const peek = await app.request(`${ORIGIN}/undangan/${invitation.id}`, {
      headers: { cookie: stranger.cookie },
    })
    expect(peek.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await peek.text()).not.toContain(invitee.email)
    const strangerAccept = await postForm(
      app,
      `${ORIGIN}/undangan/${invitation.id}`,
      stranger.cookie,
      {},
    )
    expect(strangerAccept.headers.get("location")).not.toBe(
      "/masuk/dua-langkah",
    )
    const strangerMember = await su.query(
      "SELECT 1 FROM members WHERE user_id = $1 AND organization_id = $2",
      [stranger.userId, orgId],
    )
    expect(strangerMember.rowCount).toBe(0)
    const owner = await signedIn(HOST, invitee)
    const accepted = await postForm(
      app,
      `${ORIGIN}/undangan/${invitation.id}`,
      owner.cookie,
      {},
    )
    expect(accepted.status).toBe(303)
    expect(accepted.headers.get("location")).toBe("/masuk/dua-langkah")
    const member = await su.query<{ role: string }>(
      "SELECT role FROM members WHERE user_id = $1 AND organization_id = $2",
      [owner.userId, orgId],
    )
    expect(member.rows).toEqual([{ role: "admin" }])
    expect(
      (
        await app.request(`${ORIGIN}/kelola`, {
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(403)
  })

  test("[AC-TEAM-02] Given two admins, when one removes the other and then tries to remove themself, then the colleague loses /kelola at once and an admin cannot remove themself", async () => {
    const colleague = await staffSession(HOST, orgId, person("rekan"))
    expect(
      (
        await app.request(`${ORIGIN}/kelola`, {
          headers: { cookie: colleague.cookie },
        })
      ).status,
    ).toBe(200)
    const unconfirmed = await team(admin, {
      intent: "remove",
      user: colleague.userId,
    })
    expect(unconfirmed.notice).toBe("unconfirmed")
    const removed = await team(admin, {
      intent: "remove",
      user: colleague.userId,
      confirm: "yes",
    })
    expect(removed.notice).toBe("removed")
    expect(
      (
        await app.request(`${ORIGIN}/kelola`, {
          headers: { cookie: colleague.cookie },
        })
      ).status,
    ).toBe(403)
    // Not the last admin
    await staffSession(HOST, orgId, person("cadangan"))
    const self = await team(admin, {
      intent: "remove",
      user: admin.userId,
      confirm: "yes",
    })
    expect(self.notice).toBe("self")
    const still = await su.query(
      "SELECT 1 FROM members WHERE user_id = $1 AND organization_id = $2 AND role = 'admin'",
      [admin.userId, orgId],
    )
    expect(still.rowCount).toBe(1)
  })

  test("[AC-TEAM-03] Given the settings page, when an admin pauses intake, then every report step shows the pause banner and a submit answers 503 until intake reopens", async () => {
    const paused = await settings(admin, {
      intent: "intake",
      intake: "paused",
      statusUrl: "https://status.contoh.id",
    })
    expect(paused).toEqual({ saved: "intake" })
    const home = await app.request(`${ORIGIN}/`)
    expect(await home.text()).toContain(
      "Pelaporan sedang dihentikan sementara.",
    )
    // Steps render the notice client-side
    const steps = await loaderWith<{ paused: boolean; statusHref: string }>(
      await app.request(`${ORIGIN}/lapor.data`),
      "paused",
    )
    expect(steps).toMatchObject({
      paused: true,
      statusHref: "https://status.contoh.id/",
    })
    const reporter = await signedIn(HOST, person("lapor"))
    const send = () =>
      app.request(`${ORIGIN}/lapor/periksa.data`, {
        method: "POST",
        headers: {
          cookie: reporter.cookie,
          origin: ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify(reportPayload()),
      })
    expect((await send()).status).toBe(503)
    expect(await settings(admin, { intent: "intake", intake: "open" })).toEqual(
      {
        saved: "intake",
      },
    )
    expect((await send()).status).toBe(201)
  })

  test("[AC-TEAM-04] Given the logo and theme settings, when an admin uploads an SVG or a script-bearing colour, then both are refused, and a PNG logo is served re-encoded as WebP that cannot run", async () => {
    const svg = new FormData()
    svg.set("intent", "logo")
    svg.set(
      "logo",
      new File(
        ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
        "logo.svg",
        {
          type: "image/svg+xml",
        },
      ),
    )
    const refused = await app.request(`${ORIGIN}/kelola/pengaturan.data`, {
      method: "POST",
      headers: { cookie: admin.cookie, origin: ORIGIN },
      body: svg,
    })
    expect(await actionData<Record<string, unknown>>(refused)).toEqual({
      error: "logo",
    })
    const stored = async () =>
      (
        await su.query<{ theme: unknown }>(
          "SELECT theme FROM organizations WHERE id = $1",
          [orgId],
        )
      ).rows[0]?.theme
    const before = await stored()
    const theme = await settings(admin, {
      intent: "theme",
      brand: "#0f55d6</style><script>alert(1)</script>",
    })
    expect(theme.error).toBe("theme")
    expect(await stored()).toEqual(before)
    expect(
      await settings(admin, { intent: "theme", brand: "#0b3fa0" }),
    ).toEqual({ saved: "theme" })
    const home = await app.request(`${ORIGIN}/`)
    expect(home.status).toBe(200)
    const html = await home.text()
    expect(html).toContain("--theme-brand:#0b3fa0")
    expect(html).not.toContain("<script>alert(1)</script>")
    const png = await sharp({
      create: { width: 400, height: 100, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer()
    const form = new FormData()
    form.set("intent", "logo")
    form.set(
      "logo",
      new File([new Uint8Array(png)], "logo.png", { type: "image/png" }),
    )
    const saved = await app.request(`${ORIGIN}/kelola/pengaturan.data`, {
      method: "POST",
      headers: { cookie: admin.cookie, origin: ORIGIN },
      body: form,
    })
    expect(await actionData<Record<string, unknown>>(saved)).toEqual({
      saved: "logo",
    })
    const { rows } = await su.query<{ logo_hash: string }>(
      "SELECT logo_hash FROM organizations WHERE id = $1",
      [orgId],
    )
    const file = rows[0]?.logo_hash
    const served = await app.request(`${ORIGIN}/logo/${file}.webp`)
    expect(served.status).toBe(200)
    expect(served.headers.get("Content-Type")).toBe("image/webp")
    expect(served.headers.get("Content-Security-Policy")).toContain("sandbox")
    const bytes = new Uint8Array(await served.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP")
  })

  test("[AC-TEAM-05] Given a TOTP-verified superadmin, when they add a campus from /admin, then the campus gets its own host and an invitation for its first admin, and a taken slug is refused", async () => {
    const owner = await staffSession(HOST, orgId, person("super"))
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [
      owner.userId,
    ])
    const adminEmail = `pertama.${Date.now()}@contoh.id`
    const fields = {
      intent: "create",
      campusName: "Universitas Contoh",
      name: "BEM Universitas Contoh",
      slug: `accnew${seq}`,
      campusCode: "ACCNEW",
      adminEmail,
      contactEmail: "kontak@contoh.id",
    }
    const created = await actionData<{
      created?: { host: string }
      errors?: string[]
      taken?: boolean
    }>(await postForm(app, `${ORIGIN}/admin.data?index`, owner.cookie, fields))
    expect(created.created?.host).toBe(`accnew${seq}.localhost`)
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM organizations WHERE host = $1",
      [`accnew${seq}.localhost`],
    )
    expect(rows).toHaveLength(1)
    const mail = await mailpitText(adminEmail)
    expect(mail).toContain(`accnew${seq}.localhost/undangan/`)
    const again = await actionData<{ taken?: boolean; errors?: string[] }>(
      await postForm(app, `${ORIGIN}/admin.data?index`, owner.cookie, fields),
    )
    expect(again.taken).toBe(true)
  })
})
