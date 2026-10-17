import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
import { reports } from "../../../db/schema/reports.ts"
import { withTenant } from "../../../db/tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import { type ReviewInput, reviewReport } from "./verify.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
let orgA = ""
let orgB = ""
let reporter = ""
let moderator = ""

async function seedReport(status: ReportStatus): Promise<string> {
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(orgA, reporter, { status }))
    .returning({ id: reports.id })
  if (!row) throw new Error("report not inserted")
  return row.id
}

function review(orgId: string, input: ReviewInput) {
  return withTenant(orgId, (tx) => reviewReport(tx, orgId, input), {
    role: "admin",
  })
}

async function reportRow(id: string) {
  const { rows } = await su.query<{
    status: string
    verified_at: Date | null
  }>("SELECT status, verified_at FROM reports WHERE id = $1", [id])
  return rows[0]
}

async function auditRows(entityId: string) {
  const { rows } = await su.query<{
    action: string
    actor_id: string
    reason_code: string | null
    changed_columns: string[]
  }>(
    "SELECT action, actor_id, reason_code, changed_columns FROM audit_log WHERE entity_id = $1 ORDER BY created_at",
    [entityId],
  )
  return rows
}

async function decisionRows(reportId: string) {
  const { rows } = await su.query<{
    action: string
    reason_code: string
    reason_text: string | null
    decided_by: string
  }>(
    "SELECT action, reason_code, reason_text, decided_by FROM moderation_decisions WHERE report_id = $1",
    [reportId],
  )
  return rows
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  reporter = await insertUser(su, "pelapor.verify@contoh.id")
  moderator = await insertUser(su, "moderator.verify@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM reports WHERE org_id IN ($1, $2)", [orgA, orgB])
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("reviewReport", () => {
  test("start review moves submitted to in review with an audit row", async () => {
    const id = await seedReport("submitted")
    const result = await review(orgA, {
      reportId: id,
      from: "submitted",
      action: "start_review",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: true, status: "in_review" })
    expect((await reportRow(id))?.status).toBe("in_review")
    const audit = await auditRows(id)
    expect(audit).toEqual([
      {
        action: "report.start_review",
        actor_id: moderator,
        reason_code: null,
        changed_columns: ["status"],
      },
    ])
  })

  test("verify stores the method and verified_at", async () => {
    const id = await seedReport("in_review")
    const result = await review(orgA, {
      reportId: id,
      from: "in_review",
      action: "verify",
      method: "site_photo",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: true, status: "verified" })
    const row = await reportRow(id)
    expect(row?.status).toBe("verified")
    expect(row?.verified_at).toBeInstanceOf(Date)
    const audit = await auditRows(id)
    expect(audit[0]?.action).toBe("report.verify")
    expect(audit[0]?.reason_code).toBe("site_photo")
    expect(audit[0]?.changed_columns).toEqual(["status", "verified_at"])
  })

  test("contact as the method needs the reporter's consent", async () => {
    const id = await seedReport("in_review")
    await su.query("UPDATE reports SET contactable = false WHERE id = $1", [id])
    const input: ReviewInput = {
      reportId: id,
      from: "in_review",
      action: "verify",
      method: "reporter_contact",
      actorId: moderator,
    }
    expect(await review(orgA, input)).toEqual({
      ok: false,
      reason: "no_contact_consent",
    })
    expect((await reportRow(id))?.status).toBe("in_review")
    expect(await auditRows(id)).toEqual([])
    await su.query("UPDATE reports SET contactable = true WHERE id = $1", [id])
    expect(await review(orgA, input)).toEqual({ ok: true, status: "verified" })
  })

  test("each transition queues one email to the reporter", async () => {
    const id = await seedReport("submitted")
    await review(orgA, {
      reportId: id,
      from: "submitted",
      action: "start_review",
      actorId: moderator,
    })
    const { rows } = await su.query<{
      id: string
      user_id: string
      template: string
      audited: boolean
    }>(
      `SELECT n.id, n.user_id, n.template,
         EXISTS (SELECT 1 FROM audit_log a WHERE a.id = n.event_id) AS audited
       FROM notifications n WHERE n.report_id = $1`,
      [id],
    )
    expect(rows).toEqual([
      {
        id: expect.any(String),
        user_id: reporter,
        template: "report_in_review",
        audited: true,
      },
    ])
    const jobs = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'email-send' AND data->>'notificationId' = $1",
      [rows[0]?.id],
    )
    expect(jobs.rows).toHaveLength(1)
  })

  test("the sample seed can opt out of email", async () => {
    const id = await seedReport("submitted")
    const result = await withTenant(
      orgA,
      (tx) =>
        reviewReport(
          tx,
          orgA,
          {
            reportId: id,
            from: "submitted",
            action: "start_review",
            actorId: moderator,
          },
          { notify: false },
        ),
      { role: "admin" },
    )
    expect(result.ok).toBe(true)
    const { rows } = await su.query(
      "SELECT 1 FROM notifications WHERE report_id = $1",
      [id],
    )
    expect(rows).toHaveLength(0)
  })

  test("a stale from status changes nothing", async () => {
    const id = await seedReport("verified")
    const result = await review(orgA, {
      reportId: id,
      from: "in_review",
      action: "verify",
      method: "document",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect(await auditRows(id)).toEqual([])
  })

  test("an action the state machine forbids is refused", async () => {
    const id = await seedReport("submitted")
    const result = await review(orgA, {
      reportId: id,
      from: "submitted",
      action: "verify",
      method: "document",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: false, reason: "not_allowed" })
    expect((await reportRow(id))?.status).toBe("submitted")
  })

  test("concurrent verify of one report: only one wins", async () => {
    const id = await seedReport("in_review")
    const input: ReviewInput = {
      reportId: id,
      from: "in_review",
      action: "verify",
      method: "document",
      actorId: moderator,
    }
    const results = await Promise.all([
      review(orgA, input),
      review(orgA, input),
      review(orgA, input),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "changed" },
      { ok: false, reason: "changed" },
    ])
    expect(await auditRows(id)).toHaveLength(1)
  })

  test("another tenant cannot verify the report", async () => {
    const id = await seedReport("in_review")
    const result = await review(orgB, {
      reportId: id,
      from: "in_review",
      action: "verify",
      method: "document",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect((await reportRow(id))?.status).toBe("in_review")
  })

  test("verify records the method as a decision", async () => {
    const id = await seedReport("in_review")
    await review(orgA, {
      reportId: id,
      from: "in_review",
      action: "verify",
      method: "document",
      actorId: moderator,
    })
    expect(await decisionRows(id)).toEqual([
      {
        action: "verify",
        reason_code: "document",
        reason_text: null,
        decided_by: moderator,
      },
    ])
  })

  test("reject stores the reason and guidance, emails the reporter", async () => {
    const id = await seedReport("in_review")
    const result = await review(orgA, {
      reportId: id,
      from: "in_review",
      action: "reject",
      reason: "standard_4",
      reasonText: "Laporan menyebut nama pegawai. Kirim ulang tanpa nama.",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: true, status: "rejected" })
    expect(await decisionRows(id)).toEqual([
      {
        action: "reject",
        reason_code: "standard_4",
        reason_text: "Laporan menyebut nama pegawai. Kirim ulang tanpa nama.",
        decided_by: moderator,
      },
    ])
    const audit = await auditRows(id)
    // Code only, never the text
    expect(audit).toEqual([
      {
        action: "report.reject",
        actor_id: moderator,
        reason_code: "standard_4",
        changed_columns: ["status"],
      },
    ])
    const { rows } = await su.query<{ template: string }>(
      "SELECT template FROM notifications WHERE report_id = $1",
      [id],
    )
    expect(rows).toEqual([{ template: "report_rejected" }])
  })

  test("mark unverifiable stores its reason", async () => {
    const id = await seedReport("in_review")
    const result = await review(orgA, {
      reportId: id,
      from: "in_review",
      action: "mark_unverifiable",
      reason: "no_evidence",
      reasonText: "Belum ada foto atau dokumen yang menunjukkan kejadian.",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: true, status: "unverifiable" })
    expect((await decisionRows(id))[0]?.reason_code).toBe("no_evidence")
  })

  test("reject racing verify: one decision only", async () => {
    const id = await seedReport("in_review")
    const results = await Promise.all([
      review(orgA, {
        reportId: id,
        from: "in_review",
        action: "verify",
        method: "document",
        actorId: moderator,
      }),
      review(orgA, {
        reportId: id,
        from: "in_review",
        action: "reject",
        reason: "standard_2",
        reasonText: "Laporan yang sama sudah pernah dikirim sebelumnya.",
        actorId: moderator,
      }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await decisionRows(id)).toHaveLength(1)
  })

  test("another tenant cannot reject the report", async () => {
    const id = await seedReport("in_review")
    const result = await review(orgB, {
      reportId: id,
      from: "in_review",
      action: "reject",
      reason: "standard_13",
      reasonText: "Isi laporan berupa iklan dan bukan masalah publik.",
      actorId: moderator,
    })
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect(await decisionRows(id)).toEqual([])
  })
})
