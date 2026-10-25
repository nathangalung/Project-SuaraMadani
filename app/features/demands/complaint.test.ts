import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import type { SessionContext, TenantContext } from "../../context.ts"
import {
  type ComplaintDeps,
  getOwnComplaint,
  submitComplaint,
} from "../issues/complaint.server.ts"
import {
  decideComplaint,
  getComplaint,
  listComplaints,
} from "../moderation/complaints.server.ts"
import { legalTakedownDemand } from "../moderation/legal-takedown.server.ts"
import { getDemandPage } from "./demands.server.ts"
import {
  changeDemandState,
  createDemand,
  type DemandTenant,
  getManagedDemand,
} from "./manage.server.ts"

const su = superuserPool()
const NOW = new Date("2026-10-13T03:00:00Z")
let orgId = ""
let admin = ""
let admin2 = ""
let complainant = ""
let demandTenant: DemandTenant

function tenant(): TenantContext {
  return {
    id: orgId,
    slug: "tca",
    host: "tca.localhost",
    name: "TCA",
    campusCode: "TCA",
    campusName: "TCA",
    theme: {},
    settings: {},
  }
}

function session(userId: string): SessionContext {
  const at = new Date()
  return {
    user: {
      id: userId,
      email: "pengadu@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: false,
      updatedAt: at,
    },
    session: { id: "s", createdAt: at, expiresAt: at },
  }
}

const deps: ComplaintDeps = {
  now: () => NOW,
  verifyCaptcha: async () => ({ ok: true }),
}

function form(fields: Record<string, string> = {}): FormData {
  const data = new FormData()
  const values: Record<string, string> = {
    submissionId: crypto.randomUUID(),
    reason: "accusation",
    part: "demand_items",
    explanation: "Sub-tuntutan kedua menuduh pejabat yang bisa dikenali.",
    goodFaith: "yes",
    turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
    ...fields,
  }
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

async function publishedDemand(): Promise<string> {
  const created = await createDemand(demandTenant, {
    fields: {
      scope: "national",
      provinceCode: null,
      regencyCode: null,
      category: "bantuan_sosial",
      title: "Transparansi anggaran bantuan sosial",
      body: "Kami menuntut anggaran bantuan sosial dibuka per program.",
      summary: "Anggaran bantuan sosial dibuka per program.",
      target: "Kementerian Sosial",
      raisedOn: "2026-09-01",
    },
    items: ["Dokumen anggaran per program dibuka"],
    actorId: admin,
  })
  if (!created.ok) throw new Error(created.reason)
  const demand = await getManagedDemand(orgId, created.code)
  await changeDemandState(demandTenant, {
    code: created.code,
    action: "publish",
    version: demand?.version ?? 0,
    note: null,
    actorId: admin,
  })
  return created.code
}

function submit(code: string, fields: Record<string, string> = {}) {
  return submitComplaint({
    tenant: tenant(),
    session: session(complainant),
    subject: { kind: "demand", code },
    form: form(fields),
    remoteIp: null,
    deps,
    notify: false,
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgId = await insertOrg(su, "tca")
  demandTenant = { id: orgId, host: "tca.localhost", campusCode: "TCA" }
  admin = await insertUser(su, "admin.aduan@contoh.id")
  admin2 = await insertUser(su, "admin2.aduan@contoh.id")
  complainant = await insertUser(su, "pengadu.tuntutan@contoh.id")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("tuntutan content complaints", () => {
  test("a public tuntutan takes a complaint with its own parts", async () => {
    const code = await publishedDemand()
    const sent = await submit(code)
    expect(sent.status).toBe(201)
    // Issue-only part refused
    expect(await submit(code, { part: "evidence" })).toEqual({
      status: 400,
      body: { errors: ["part"] },
    })
    if (!("code" in sent.body)) throw new Error("no code")
    const own = await getOwnComplaint(orgId, sent.body.code, complainant, NOW)
    expect(own?.subject).toEqual({
      kind: "demand",
      code,
      title: "Transparansi anggaran bantuan sosial",
      published: true,
    })
    const rows = await listComplaints(orgId, "admin", "baru")
    expect(rows.map((row) => row.subject)).toContainEqual({
      kind: "demand",
      code,
      title: "Transparansi anggaran bantuan sosial",
    })
  })

  test("a draft tuntutan cannot be complained about", async () => {
    const created = await createDemand(demandTenant, {
      fields: {
        scope: "national",
        provinceCode: null,
        regencyCode: null,
        category: "bantuan_sosial",
        title: "Draf tuntutan yang belum terbit",
        body: "Teks draf tuntutan yang belum terbit.",
        summary: "Ringkasan draf yang belum terbit.",
        target: "Kementerian",
        raisedOn: "2026-09-01",
      },
      items: [],
      actorId: admin,
    })
    if (!created.ok) throw new Error(created.reason)
    expect((await submit(created.code)).status).toBe(404)
  })

  test("hide moves it back to draft, edit and remove are refused", async () => {
    const code = await publishedDemand()
    const sent = await submit(code)
    if (!("code" in sent.body)) throw new Error("no code")
    const detail = await getComplaint(orgId, "admin", sent.body.code)
    if (!detail?.demand) throw new Error("no demand detail")
    expect(detail.issue).toBeNull()
    const base = {
      complaintId: detail.id,
      stage: "first" as const,
      reason: "standard_2" as const,
      statement:
        "Nama pejabat dihapus, tuntutan disembunyikan sampai diperbaiki.",
      actorId: admin,
      subjectVersion: detail.demand.version,
      notify: false,
    }
    expect(
      await decideComplaint(
        { id: orgId, host: "tca.localhost" },
        { ...base, decision: "remove" },
      ),
    ).toEqual({ ok: false, reason: "not_allowed" })
    const brief = await su.query<{ id: string }>(
      `INSERT INTO policy_briefs (org_id, item_id, status, sha256, byte_size, scanned_at, published_at)
       SELECT org_id, id, 'clean', repeat('a', 64), 10, now(), now() FROM demand_items
       WHERE demand_id = (SELECT id FROM demands WHERE public_code = $1) LIMIT 1
       RETURNING id`,
      [code],
    )
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary, category_id, subcategory_id, province_code, regency_code, report_count, published_at)
       VALUES ($1, 2026, 9, 'ISU-TCA-26-0009', 'Isu terkait', 'Isu yang dikutip tuntutan ini.', 'bansos', 'bansos.pangan', '32', '32.73', 1, now())`,
      [orgId],
    )
    await su.query(
      `INSERT INTO demand_issues (org_id, demand_id, issue_id)
       SELECT d.org_id, d.id, i.id FROM demands d, issues i
       WHERE d.public_code = $1 AND i.public_code = 'ISU-TCA-26-0009'`,
      [code],
    )
    const purged: string[] = []
    expect(
      await decideComplaint(
        { id: orgId, host: "tca.localhost" },
        { ...base, decision: "hide" },
        {
          purge: {
            purgeUrls: async (urls) => {
              purged.push(...urls)
              return { skipped: false }
            },
            purgeHosts: async () => ({ skipped: false }),
          },
        },
      ),
    ).toEqual({ ok: true })
    // Brief PDFs leave the CDN
    expect(purged).toContain(
      `https://tca.localhost/tuntutan/${code}/dokumen/${brief.rows[0]?.id}.pdf`,
    )
    // Cited issue drops its block
    expect(purged).toContain("https://tca.localhost/isu/ISU-TCA-26-0009")
    expect(await getDemandPage(orgId, code)).toBeNull()
    const managed = await getManagedDemand(orgId, code)
    expect(managed?.state).toBe("draft")
    expect(managed?.hiddenReason).toBe("standard_2")
    const { rows } = await su.query(
      "SELECT action FROM audit_log WHERE action = 'demand.hide' AND entity_id = $1",
      [managed?.id],
    )
    expect(rows).toHaveLength(1)
    // CMP-18: durable purge, late alert
    const takedown = await su.query(
      "SELECT action, issue_id, complaint_id, purge_status FROM takedowns WHERE complaint_id = $1",
      [detail.id],
    )
    expect(takedown.rows).toEqual([
      {
        action: "unpublish",
        issue_id: null,
        complaint_id: detail.id,
        purge_status: "pending",
      },
    ])
    // Republish clears the hidden mark
    await changeDemandState(demandTenant, {
      code,
      action: "publish",
      version: managed?.version ?? 0,
      note: null,
      actorId: admin2,
    })
    const again = await getManagedDemand(orgId, code)
    expect(again?.state).toBe("published")
    expect(again?.hiddenAt).toBeNull()
  })
})

describe("tuntutan legal takedown", () => {
  test("a Komdigi order hides it with the legal reason", async () => {
    const code = await publishedDemand()
    const managed = await getManagedDemand(orgId, code)
    const input = {
      code,
      version: managed?.version ?? 0,
      reason: "komdigi_order" as const,
      actorId: admin,
    }
    const quiet = {
      purge: {
        purgeUrls: async () => ({ skipped: false }),
        purgeHosts: async () => ({ skipped: false }),
      },
    }
    const target = { id: orgId, host: "tca.localhost" }
    expect(
      await legalTakedownDemand(target, { ...input, version: 99 }, quiet),
    ).toEqual({ ok: false, reason: "changed" })
    expect(
      await legalTakedownDemand(
        target,
        { ...input, reason: "standard_1" as unknown as "komdigi_order" },
        quiet,
      ),
    ).toEqual({ ok: false, reason: "not_allowed" })
    expect(await legalTakedownDemand(target, input, quiet)).toEqual({
      ok: true,
    })
    expect(await getDemandPage(orgId, code)).toBeNull()
    const hidden = await getManagedDemand(orgId, code)
    expect(hidden?.hiddenReason).toBe("komdigi_order")
    const audit = await su.query(
      "SELECT reason_code FROM audit_log WHERE action = 'demand.hide' AND entity_id = $1",
      [hidden?.id],
    )
    expect(audit.rows).toEqual([{ reason_code: "komdigi_order" }])
    const takedown = await su.query(
      "SELECT action, complaint_id, created_by FROM takedowns WHERE org_id = $1 AND complaint_id IS NULL",
      [orgId],
    )
    expect(takedown.rows).toEqual([
      { action: "unpublish", complaint_id: null, created_by: admin },
    ])
    // Already hidden: nothing to do
    expect(
      await legalTakedownDemand(
        target,
        { ...input, version: hidden?.version ?? 0 },
        quiet,
      ),
    ).toEqual({ ok: false, reason: "not_allowed" })
  })
})
