import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
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
  queued,
  routeContext,
  type Staff,
  signedIn,
  staffSession,
  stubTurnstile,
} from "../../../e2e/app-harness.ts"
import {
  postForm,
  publishIssue,
  reportToIssue,
  submitReport,
} from "../../../e2e/staff-flows.ts"
import { defaultFilesDir } from "../../../server/files.server.ts"
import { jakartaIsoDate } from "../../../shared/format.ts"
import { createBriefScanHandler } from "../../../worker/evidence-brief.ts"
import { hideRaterName } from "./rating.server.ts"

const HOST = "accdem.localhost"
const ORIGIN = `http://${HOST}`
const su = superuserPool()
const YEAR = jakartaIsoDate(new Date()).slice(2, 4)
// worker-media role, real grants
const mediaPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sb_media",
})
let app: FullApp
let orgId = ""
let admin: Staff
let restore = () => {}
let seq = 0

type Saved = {
  saved?: string
  errors?: string[]
  conflict?: true
  unchanged?: true
}

function person(label: string) {
  seq += 1
  return {
    email: `${label}.${seq}@contoh.id`,
    phone: `+62813111${String(seq).padStart(5, "0")}`,
    name: "Warga Tuntutan",
  }
}

const today = () => jakartaIsoDate(new Date())

const FIELDS = {
  scope: "regional",
  provinceCode: "32",
  regencyCode: "32.73",
  category: "infrastruktur_transportasi",
  title: "Perbaikan jalan rusak di Kota Bandung",
  body: "Kami menuntut perbaikan jalan rusak di seluruh Kota Bandung.",
  summary: "Perbaikan jalan rusak dan jadwal yang terbuka untuk warga.",
  target: "Pemerintah Kota Bandung",
  raisedOn: "2026-08-01",
}

/** Admin creates draft, HTTP. */
async function createDraft(
  overrides: Record<string, string> = {},
): Promise<string> {
  const res = await postForm(
    app,
    `${ORIGIN}/kelola/tuntutan/baru`,
    admin.cookie,
    {
      ...FIELDS,
      items: "Perbaiki jalan utama\nUmumkan jadwal perbaikan",
      ...overrides,
    },
  )
  const code = /\/kelola\/tuntutan\/([^?#]+)/.exec(
    res.headers.get("location") ?? "",
  )?.[1]
  if (res.status !== 303 || !code) throw new Error(`create ${res.status}`)
  return code
}

async function demandRow(code: string) {
  const { rows } = await su.query<{
    id: string
    version: number
    state: string
    progress: string
  }>(
    "SELECT id, version, state, progress FROM demands WHERE public_code = $1",
    [code],
  )
  const row = rows[0]
  if (!row) throw new Error(`no demand ${code}`)
  return row
}

async function items(code: string) {
  const { rows } = await su.query<{
    id: string
    version: number
    response_status: string
    fulfilment_status: string
  }>(
    `SELECT i.id, i.version, i.response_status, i.fulfilment_status
     FROM demand_items i JOIN demands d ON d.id = i.demand_id
     WHERE d.public_code = $1 ORDER BY i.position`,
    [code],
  )
  return rows
}

/** Editor POST, single fetch. */
async function edit(code: string, fields: Record<string, string>) {
  const res = await postForm(
    app,
    `${ORIGIN}/kelola/tuntutan/${code}.data`,
    admin.cookie,
    fields,
  )
  return { status: res.status, data: await actionData<Saved>(res) }
}

async function changeState(code: string, intent: string, note = "") {
  const { version } = await demandRow(code)
  return edit(code, { intent, version: String(version), note })
}

async function published(): Promise<string> {
  const code = await createDraft()
  const { data } = await changeState(code, "publish")
  if (data.saved !== "publish") throw new Error(JSON.stringify(data))
  return code
}

function update(
  code: string,
  item: { id: string; version: number },
  fields: Record<string, string>,
) {
  return edit(code, {
    intent: "update_item",
    itemId: item.id,
    version: String(item.version),
    occurredOn: today(),
    note: "Dinas menyampaikan tanggapan resmi.",
    sourceText: "Siaran pers Dinas PU Kota Bandung",
    sourceUrl: "https://pu.bandung.go.id/siaran/1",
    ...fields,
  })
}

function rate(
  cookie: string,
  code: string,
  fields: Record<string, string>,
  ip = "10.7.0.1",
) {
  return app.request(`${ORIGIN}/tuntutan/${code}/nilai`, {
    method: "POST",
    headers: {
      cookie,
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
      "x-client-ip": ip,
    },
    body: new URLSearchParams({
      intent: "rate",
      submissionId: crypto.randomUUID(),
      score: "4",
      visibility: "anonymous",
      turnstileToken: CAPTCHA_PASS,
      ...fields,
    }),
  })
}

async function ratingOf(code: string, userId: string) {
  const { rows } = await su.query<{ score: number; show_name: boolean }>(
    `SELECT r.score, r.show_name FROM demand_ratings r
     JOIN demands d ON d.id = r.demand_id
     WHERE d.public_code = $1 AND r.user_id = $2`,
    [code, userId],
  )
  return rows[0] ?? null
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "accdem")
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
  await rm(join(resolve(defaultFilesDir()), "evidence", "briefs", orgId), {
    recursive: true,
    force: true,
  })
  await rm(join(resolve(defaultFilesDir()), "derived", "briefs", orgId), {
    recursive: true,
    force: true,
  })
  await resetData(su)
  await mediaPool.end()
  await su.end()
})

describe("tuntutan editor", () => {
  test("[AC-DEMAND-01] Given the admin editor, when a tuntutan is created and published, then a category is required, a draft stays private and a row without category cannot be published", async () => {
    const missing = await postForm(
      app,
      `${ORIGIN}/kelola/tuntutan/baru.data`,
      admin.cookie,
      { ...FIELDS, category: "", items: "Satu subtuntutan" },
    )
    expect((await actionData<Saved>(missing)).errors).toContain("category")
    const code = await createDraft()
    expect(code).toMatch(new RegExp(`^TUN-ACCDEM-${YEAR}-\\d{4}$`))
    expect((await app.request(`${ORIGIN}/tuntutan/${code}`)).status).toBe(404)
    const { data } = await changeState(code, "publish")
    expect(data.saved).toBe("publish")
    const page = await app.request(`${ORIGIN}/tuntutan/${code}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(FIELDS.title)
    expect(await (await app.request(`${ORIGIN}/tuntutan`)).text()).toContain(
      code,
    )
    const legacy = await createDraft({ title: "Tuntutan lama tanpa kategori" })
    await su.query(
      "UPDATE demands SET category = NULL WHERE public_code = $1",
      [legacy],
    )
    const refused = await changeState(legacy, "publish")
    expect(refused.data.errors).toContain("publish_category")
    expect((await demandRow(legacy)).state).toBe("draft")
  })

  test("[AC-DEMAND-02] Given a published sub-tuntutan, when status updates are recorded, then each must move an axis, keep Direspons, reject only after a response, be dated from the raise date, carry a source text and only an http(s) link", async () => {
    const code = await published()
    const [item] = await items(code)
    if (!item) throw new Error("no item")
    const cases: [Record<string, string>, string][] = [
      [{ response: "not_responded", fulfilment: "rejected" }, "status"],
      [
        {
          response: "responded",
          fulfilment: "not_fulfilled",
          occurredOn: "2026-07-01",
        },
        "occurred_on",
      ],
      [
        { response: "responded", fulfilment: "not_fulfilled", sourceText: "" },
        "source_text",
      ],
      [
        {
          response: "responded",
          fulfilment: "not_fulfilled",
          sourceUrl: "javascript:alert(1)",
        },
        "source_url",
      ],
    ]
    for (const [fields, error] of cases) {
      const res = await update(code, item, fields)
      expect(res.data.errors).toContain(error)
    }
    // Same state: note only
    const note = await update(code, item, {
      response: "not_responded",
      fulfilment: "not_fulfilled",
    })
    expect(note.data.saved).toBe("update_item")
    const [unchanged] = await items(code)
    expect(unchanged?.response_status).toBe("not_responded")
    if (!unchanged) throw new Error("no item")
    const ok = await update(code, unchanged, {
      response: "responded",
      fulfilment: "not_fulfilled",
    })
    expect(ok.data.saved).toBe("update_item")
    const [after] = await items(code)
    if (!after) throw new Error("no item")
    const back = await update(code, after, {
      response: "not_responded",
      fulfilment: "not_fulfilled",
    })
    expect(back.data.errors).toContain("status")
    const page = await (await app.request(`${ORIGIN}/tuntutan/${code}`)).text()
    expect(page).toContain("Siaran pers Dinas PU Kota Bandung")
    expect(page).toContain("Admin KM accdem")
  })

  test("[AC-DEMAND-03] Given two sub-tuntutan, when one is fulfilled, then the progress is computed as one of two and the overall status is partly fulfilled", async () => {
    const code = await published()
    const [first, second] = await items(code)
    if (!first || !second) throw new Error("two items expected")
    await update(code, first, {
      response: "responded",
      fulfilment: "fulfilled",
    })
    const json = await (
      await app.request(`${ORIGIN}/api/v1/tuntutan/${code}`)
    ).json()
    expect(json.demand.progress).toMatchObject({
      total: 2,
      fulfilled: 1,
      status: "partially_fulfilled",
    })
    expect((await demandRow(code)).progress).toBe("partially_fulfilled")
    const [, again] = await items(code)
    if (!again) throw new Error("second item")
    await update(code, again, {
      response: "responded",
      fulfilment: "fulfilled",
    })
    expect((await demandRow(code)).progress).toBe("fulfilled")
  })

  test("[AC-DEMAND-04] Given tuntutan in each state, when they are closed, reopened and deleted, then closing needs a public reason, reopening publishes again, and only a never-published draft can be deleted", async () => {
    const code = await published()
    const bare = await changeState(code, "close", "")
    expect(bare.data.errors).toContain("close_note")
    const closed = await changeState(
      code,
      "close",
      "Ditutup karena pemerintah kota menolak semua subtuntutan.",
    )
    expect(closed.data.saved).toBe("close")
    expect((await demandRow(code)).state).toBe("closed")
    expect(
      await (await app.request(`${ORIGIN}/tuntutan/${code}`)).text(),
    ).toContain("Ditutup karena pemerintah kota menolak semua subtuntutan.")
    const reopened = await changeState(code, "reopen")
    expect(reopened.data.saved).toBe("reopen")
    expect((await demandRow(code)).state).toBe("published")
    const kept = await edit(code, { intent: "delete" })
    expect(kept.data.saved).toBeUndefined()
    expect((await demandRow(code)).state).toBe("published")
    const draft = await createDraft({ title: "Draf yang akan dihapus saja" })
    const gone = await postForm(
      app,
      `${ORIGIN}/kelola/tuntutan/${draft}`,
      admin.cookie,
      { intent: "delete" },
    )
    expect(gone.status).toBe(303)
    const { rowCount } = await su.query(
      "SELECT 1 FROM demands WHERE public_code = $1",
      [draft],
    )
    expect(rowCount).toBe(0)
  })

  test("[AC-DEMAND-05] Given a follower of a tuntutan, when it gets a sourced update and is closed, then the follower receives one email per event", async () => {
    const code = await published()
    // Worker ran the publish fan-out
    await mailbox().deliver(su, orgId)
    const follower = await signedIn(HOST, person("pengikut"))
    const follow = await postForm(
      app,
      `${ORIGIN}/tuntutan/${code}`,
      follower.cookie,
      { intent: "follow" },
    )
    expect(follow.status).toBe(303)
    const [item] = await items(code)
    if (!item) throw new Error("no item")
    await update(code, item, { response: "responded", fulfilment: "rejected" })
    await changeState(
      code,
      "close",
      "Ditutup karena pemerintah kota menolak semua subtuntutan.",
    )
    const address = (
      await su.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [follower.userId],
      )
    ).rows[0]?.email
    const box = mailbox()
    await box.deliver(su, orgId)
    const mails = box.sent.filter((m) => m.to === address)
    expect(mails).toHaveLength(2)
    for (const mail of mails) expect(mail.text).toContain(code)
  })
})

describe("importance ratings", () => {
  test("[AC-DEMAND-06] Given published, closed, draft and hidden tuntutan, when people rate, change and withdraw, then only signed-in, Turnstile-checked ratings of published tuntutan are kept, one per account", async () => {
    const code = await published()
    const page = await app.request(`${ORIGIN}/tuntutan/${code}/nilai`)
    expect(page.headers.get("Cache-Control")).toBe("private, no-store")
    expect((await rate("", code, {})).status).toBe(401)
    const rater = await signedIn(HOST, person("nilai"))
    expect(
      (await rate(rater.cookie, code, { turnstileToken: "robot" })).status,
    ).toBe(403)
    expect((await rate(rater.cookie, code, { score: "6" })).status).toBe(400)
    expect((await rate(rater.cookie, code, {})).status).toBe(303)
    expect(await ratingOf(code, rater.userId)).toEqual({
      score: 4,
      show_name: false,
    })
    await rate(rater.cookie, code, { score: "2", visibility: "named" })
    expect(await ratingOf(code, rater.userId)).toEqual({
      score: 2,
      show_name: true,
    })
    await changeState(
      code,
      "close",
      "Ditutup karena tuntutan sudah dibahas dalam audiensi.",
    )
    const late = await signedIn(HOST, person("telat"))
    expect((await rate(late.cookie, code, {})).status).toBe(409)
    const withdraw = await postForm(
      app,
      `${ORIGIN}/tuntutan/${code}/nilai`,
      rater.cookie,
      { intent: "withdraw" },
    )
    expect(withdraw.status).toBe(303)
    expect(await ratingOf(code, rater.userId)).toBeNull()
    const draft = await createDraft({ title: "Draf yang belum terbit" })
    // Takedown hides back to draft
    const hidden = await published()
    await su.query(
      `UPDATE demands SET state = 'draft', hidden_at = now(), hidden_reason = 'standard_3'
       WHERE public_code = $1`,
      [hidden],
    )
    for (const closedOff of [draft, hidden]) {
      expect((await rate(rater.cookie, closedOff, {})).status).toBe(404)
      expect(
        (await app.request(`${ORIGIN}/tuntutan/${closedOff}/nilai`)).status,
      ).toBe(404)
    }
  })

  test("[AC-DEMAND-07] Given ratings from new and older accounts, when the tuntutan page is read, then young accounts wait seven days, the score needs ten raters and only counted raters who chose to be named are listed, without contact data", async () => {
    const code = await published()
    const { id } = await demandRow(code)
    const named = await insertUser(su, "bernama.lama@contoh.id")
    await su.query(
      `UPDATE users SET name = 'Rina Lama', created_at = now() - interval '30 days' WHERE id = $1`,
      [named],
    )
    await su.query(
      `INSERT INTO demand_ratings (org_id, demand_id, user_id, score, show_name)
       VALUES ($1, $2, $3, 5, true)`,
      [orgId, id, named],
    )
    const young = await insertUser(su, "bernama.baru@contoh.id")
    await su.query("UPDATE users SET name = 'Budi Baru' WHERE id = $1", [young])
    await su.query(
      `INSERT INTO demand_ratings (org_id, demand_id, user_id, score, show_name)
       VALUES ($1, $2, $3, 1, true)`,
      [orgId, id, young],
    )
    const html = await (await app.request(`${ORIGIN}/tuntutan/${code}`)).text()
    expect(html).toContain("Skor tampil setelah ada minimal 10 penilai")
    expect(html).toContain("Rina Lama")
    expect(html).not.toContain("Budi Baru")
    expect(html).not.toContain("bernama.lama@contoh.id")
    const editor = await app.request(`${ORIGIN}/kelola/tuntutan/${code}.data`, {
      headers: { cookie: admin.cookie },
    })
    const { demand } = await loaderWith<{
      demand: { pendingRaters: number }
    }>(editor, "demand")
    expect(demand.pendingRaters).toBe(1)
  })

  test("[AC-DEMAND-08] Given twenty accounts that rated from one address prefix, when a twenty-first account rates from it, then the server answers 429 while another prefix is served", async () => {
    const code = await published()
    for (let i = 0; i < 20; i++) {
      const one = await signedIn(HOST, person(`prefiks${i}`))
      expect((await rate(one.cookie, code, {}, "10.66.0.9")).status).toBe(303)
    }
    const extra = await signedIn(HOST, person("keduapuluhsatu"))
    const capped = await rate(extra.cookie, code, {}, "10.66.0.9")
    expect(capped.status).toBe(429)
    expect(await ratingOf(code, extra.userId)).toBeNull()
    expect((await rate(extra.cookie, code, {}, "10.67.0.9")).status).toBe(303)
  })

  test("[AC-DEMAND-10] Given ten ratings of a tuntutan, when the admin editor is read, then it flags the tuntutan when one address prefix holds more than 30% of them, and not at 30%", async () => {
    const flagOf = async (shared: number) => {
      const code = await published()
      for (let i = 0; i < 10; i++) {
        const one = await signedIn(HOST, person(`anomali${shared}x${i}`))
        const ip = i < shared ? "10.80.0.1" : `10.81.${shared}.${i}`
        expect((await rate(one.cookie, code, {}, ip)).status).toBe(303)
      }
      const editor = await app.request(
        `${ORIGIN}/kelola/tuntutan/${code}.data`,
        { headers: { cookie: admin.cookie } },
      )
      expect(editor.status).toBe(200)
      const { demand } = await loaderWith<{
        demand: { prefixAnomaly: boolean }
      }>(editor, "demand")
      return demand.prefixAnomaly
    }
    expect(await flagOf(4)).toBe(true)
    expect(await flagOf(3)).toBe(false)
  })

  test("[AC-DEMAND-09] Given a sub-tuntutan, when the admin uploads a policy brief, then only a PDF up to 10 MB is taken, and it downloads as a sandboxed attachment only after a clean scan and publication", async () => {
    const code = await published()
    const [item] = await items(code)
    if (!item) throw new Error("no item")
    const send = (bytes: Uint8Array<ArrayBuffer>) => {
      const form = new FormData()
      form.set("itemId", item.id)
      form.set(
        "brief",
        new File([bytes], "kajian.pdf", { type: "application/pdf" }),
      )
      return app.request(`${ORIGIN}/kelola/tuntutan/${code}/unggah`, {
        method: "POST",
        headers: { cookie: admin.cookie, origin: ORIGIN },
        body: form,
      })
    }
    const fake = await send(new TextEncoder().encode("bukan pdf sama sekali"))
    expect(fake.headers.get("location")).toContain("dokumen=bukan-pdf")
    // A real PDF header, oversized
    const large = new Uint8Array(10 * 1024 * 1024 + 1)
    large.set(new TextEncoder().encode("%PDF-1.4\n"))
    const big = await send(large)
    expect(big.status).toBe(303)
    expect(big.headers.get("location")).toContain("dokumen=besar")
    const pdf = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    )
    const ok = await send(pdf)
    expect(ok.headers.get("location")).toContain("dokumen=diunggah")
    const { rows } = await su.query<{ id: string; status: string }>(
      `SELECT b.id, b.status FROM policy_briefs b WHERE b.item_id = $1`,
      [item.id],
    )
    expect(rows).toHaveLength(1)
    const briefId = rows[0]?.id ?? ""
    const url = `${ORIGIN}/tuntutan/${code}/dokumen/${briefId}.pdf`
    expect((await app.request(url)).status).toBe(404)
    const jobs = await queued<{ orgId: string; briefId: string }>(
      su,
      "evidence-brief",
      orgId,
    )
    const scan = createBriefScanHandler({
      filesDir: defaultFilesDir(),
      db: drizzle({ client: mediaPool, schema }),
    })
    for (const job of jobs) await scan(job.data)
    const scanned = await su.query<{ status: string }>(
      "SELECT status FROM policy_briefs WHERE id = $1",
      [briefId],
    )
    expect(scanned.rows[0]?.status).toBe("clean")
    // Clean, not yet published
    expect((await app.request(url)).status).toBe(404)
    const published_ = await edit(code, {
      intent: "publish_brief",
      briefId,
    })
    expect(published_.data.saved).toBe("publish_brief")
    const file = await app.request(url)
    expect(file.status).toBe(200)
    expect(file.headers.get("Content-Type")).toBe("application/pdf")
    expect(file.headers.get("Content-Disposition")).toStartWith("attachment;")
    expect(file.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(file.headers.get("Content-Security-Policy")).toContain("sandbox")
    expect(file.headers.get("Cloudflare-CDN-Cache-Control")).toContain(
      "max-age=60",
    )
    const draft = await createDraft({ title: "Draf dengan kajian tersembunyi" })
    const draftUrl = `${ORIGIN}/tuntutan/${draft}/dokumen/${briefId}.pdf`
    expect((await app.request(draftUrl)).status).toBe(404)
  })
})

describe("tuntutan editor tools", () => {
  test("[AC-DEMAND-11] Given a published tuntutan with two sub-tuntutan, when the admin moves one down and links then unlinks a published issue, then the public JSON follows the new order and the link, an unpublished issue cannot be linked, and each change is audited", async () => {
    const code = await published()
    const [first, second] = await items(code)
    if (!first || !second) throw new Error("two items")
    const moved = await edit(code, { intent: "move_down", itemId: first.id })
    expect(moved.data.saved).toBe("move_down")
    const json = async () =>
      (
        (await (
          await app.request(`${ORIGIN}/api/v1/tuntutan/${code}`)
        ).json()) as {
          demand: {
            items: { number: number; body: string }[]
            issues: { code: string }[]
          }
        }
      ).demand
    expect((await json()).items).toEqual([
      expect.objectContaining({ number: 1, body: "Umumkan jadwal perbaikan" }),
      expect.objectContaining({ number: 2, body: "Perbaiki jalan utama" }),
    ])
    const owner = await signedIn(HOST, person("pelapor"))
    const { code: report } = await submitReport(app, HOST, owner.cookie)
    const issue = await reportToIssue(app, su, HOST, admin.cookie, report)
    const hidden = await edit(code, { intent: "link_issue", issueCode: issue })
    expect(hidden.data.errors).toEqual(["issue_code"])
    await publishIssue(app, su, HOST, admin.cookie, issue)
    const linked = await edit(code, { intent: "link_issue", issueCode: issue })
    expect(linked.data.saved).toBe("link_issue")
    expect((await json()).issues.map((one) => one.code)).toEqual([issue])
    const issueJson = (await (
      await app.request(`${ORIGIN}/api/v1/isu/${issue}`)
    ).json()) as { issue: { demands: { code: string }[] } }
    expect(issueJson.issue.demands.map((one) => one.code)).toEqual([code])
    const unlinked = await edit(code, {
      intent: "unlink_issue",
      issueCode: issue,
    })
    expect(unlinked.data.saved).toBe("unlink_issue")
    expect((await json()).issues).toEqual([])
    const audit = await su.query<{ action: string }>(
      `SELECT action FROM audit_log
       WHERE org_id = $1 AND action IN ('demand.item_move', 'demand.issue_link', 'demand.issue_unlink')
         AND entity_id = (SELECT id FROM demands WHERE public_code = $2)
       ORDER BY created_at`,
      [orgId, code],
    )
    expect(audit.rows.map((row) => row.action)).toEqual([
      "demand.item_move",
      "demand.issue_link",
      "demand.issue_unlink",
    ])
  })

  test("[AC-DEMAND-12] Given a counted rater who chose to be named, when an admin hides the name under a content standard, then the public page drops the name, the rating stays, and the hide is audited", async () => {
    const code = await published()
    const { id } = await demandRow(code)
    const named = await insertUser(su, "disembunyikan.lama@contoh.id")
    await su.query(
      `UPDATE users SET name = 'Sari Tersembunyi', created_at = now() - interval '30 days' WHERE id = $1`,
      [named],
    )
    await su.query(
      `INSERT INTO demand_ratings (org_id, demand_id, user_id, score, show_name)
       VALUES ($1, $2, $3, 4, true)`,
      [orgId, id, named],
    )
    const page = async () =>
      (await app.request(`${ORIGIN}/tuntutan/${code}`)).text()
    expect(await page()).toContain("Sari Tersembunyi")
    const { tenant, session } = await routeContext(HOST, admin.cookie)
    if (!session) throw new Error("no admin session")
    const hide = (userId: string, reason: string) =>
      hideRaterName(tenant, {
        code,
        userId,
        reason: reason as "standard_2",
        actorId: session.user.id,
      })
    expect(await hide(named, "out_of_scope")).toEqual({
      ok: false,
      reason: "not_allowed",
    })
    expect(await hide(crypto.randomUUID(), "standard_2")).toEqual({
      ok: false,
      reason: "not_found",
    })
    expect(await hide(named, "standard_2")).toEqual({ ok: true })
    expect(await page()).not.toContain("Sari Tersembunyi")
    const kept = await su.query(
      "SELECT score, show_name FROM demand_ratings WHERE demand_id = $1 AND user_id = $2",
      [id, named],
    )
    expect(kept.rows).toEqual([{ score: 4, show_name: true }])
    const audit = await su.query(
      "SELECT reason_code FROM audit_log WHERE action = 'demand.rater_hide' AND org_id = $1 AND actor_id = $2",
      [orgId, session.user.id],
    )
    expect(audit.rows).toEqual([{ reason_code: "standard_2" }])
  })

  test("[AC-DEMAND-13] Given a draft with a loaded word, double exclamation marks and a shouted slogan, when the admin editor is read, then it lists each finding as advice that does not block publishing, and a neutral draft gets none", async () => {
    const loud = await createDraft({
      title: "Pejabat korup harus turun!!",
      summary: "Kami menuntut SEGERA USUT TUNTAS kasus jalan rusak di kota.",
    })
    const neutral = async (code: string) => {
      const editor = await app.request(
        `${ORIGIN}/kelola/tuntutan/${code}.data`,
        { headers: { cookie: admin.cookie } },
      )
      expect(editor.status).toBe(200)
      return (
        await loaderWith<{ neutral: { kind: string; word?: string }[] }>(
          editor,
          "neutral",
        )
      ).neutral
    }
    expect(await neutral(loud)).toEqual([
      { kind: "word", word: "korup" },
      { kind: "exclamation" },
      { kind: "shouting" },
    ])
    expect((await changeState(loud, "publish")).data.saved).toBe("publish")
    expect(await neutral(await createDraft())).toEqual([])
  })
})
