import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import { reports } from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { staffContext } from "../../../server/request-context.server.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import {
  type SessionContext,
  sessionContext,
  tenantContext,
} from "../../context.ts"
import { runMerge } from "./merge.server.ts"
import {
  closeAccountAction,
  issuePageAction,
  parsePublishForm,
  parseReviewForm,
  reportPageAction,
} from "./review-actions.server.ts"

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    for (const item of [value].flat()) data.append(key, item)
  }
  return data
}

const ISSUE_ID = "0199c2b0-1d2e-7000-8000-000000000001"

describe("parseReviewForm", () => {
  test("start review carries the status the admin saw", () => {
    expect(
      parseReviewForm(form({ intent: "start_review", from: "submitted" })),
    ).toEqual({ action: "start_review", from: "submitted" })
  })

  test("verify needs a method", () => {
    expect(
      parseReviewForm(form({ intent: "verify", from: "in_review" })),
    ).toEqual({ errors: ["verify_method"], intent: "verify" })
    expect(
      parseReviewForm(
        form({ intent: "verify", from: "in_review", method: "news_source" }),
      ),
    ).toEqual({ action: "verify", from: "in_review", method: "news_source" })
  })

  test("reporter contact verifies, contacts are readable", () => {
    expect(
      parseReviewForm(
        form({
          intent: "verify",
          from: "in_review",
          method: "reporter_contact",
        }),
      ),
    ).toEqual({
      action: "verify",
      from: "in_review",
      method: "reporter_contact",
    })
  })

  test("merge into a new issue checks title and summary", () => {
    expect(
      parseReviewForm(
        form({ intent: "merge", target: "new", title: "pendek", summary: "" }),
      ),
    ).toEqual({ errors: ["issue_title", "issue_summary"], intent: "merge" })
    expect(
      parseReviewForm(
        form({
          intent: "merge",
          target: "new",
          title: "  Atap sekolah runtuh  ",
          summary: "Beberapa laporan menyebut atap runtuh.",
        }),
      ),
    ).toEqual({
      action: "merge",
      target: {
        kind: "new",
        title: "Atap sekolah runtuh",
        summary: "Beberapa laporan menyebut atap runtuh.",
      },
    })
  })

  test("merge into an existing issue needs its id", () => {
    expect(
      parseReviewForm(form({ intent: "merge", target: "existing" })),
    ).toEqual({ errors: ["merge_issue"], intent: "merge" })
    expect(
      parseReviewForm(
        form({ intent: "merge", target: "existing", issueId: ISSUE_ID }),
      ),
    ).toEqual({
      action: "merge",
      target: { kind: "existing", issueId: ISSUE_ID },
    })
  })

  test("reject cites a standard and explains it", () => {
    expect(
      parseReviewForm(
        form({ intent: "reject", from: "in_review", reason: "standard_99" }),
      ),
    ).toEqual({ errors: ["reject_reason", "reject_text"], intent: "reject" })
    expect(
      parseReviewForm(
        form({
          intent: "reject",
          from: "in_review",
          reason: "standard_4",
          reasonText:
            "Laporan menyebut nama pegawai.\r\nKirim ulang tanpa nama.",
        }),
      ),
    ).toEqual({
      action: "reject",
      from: "in_review",
      reason: "standard_4",
      reasonText: "Laporan menyebut nama pegawai.\nKirim ulang tanpa nama.",
    })
  })

  test("unverifiable has its own reasons", () => {
    expect(
      parseReviewForm(
        form({
          intent: "mark_unverifiable",
          from: "in_review",
          reason: "standard_4",
          reasonText: "Belum ada bukti yang bisa diperiksa moderator.",
        }),
      ),
    ).toEqual({ errors: ["unverifiable_reason"], intent: "mark_unverifiable" })
  })

  test("forward needs a campus id", () => {
    expect(
      parseReviewForm(form({ intent: "forward", targetOrgId: "itb" })),
    ).toEqual({ errors: ["forward_target"], intent: "forward" })
    expect(
      parseReviewForm(form({ intent: "forward", targetOrgId: ISSUE_ID })),
    ).toEqual({ action: "forward", targetOrgId: ISSUE_ID })
  })

  test.each<Record<string, string>>([
    { intent: "delete" },
    { intent: "start_review", from: "nonsense" },
    { intent: "merge", target: "other" },
  ])("rejects %p", (values) => {
    expect(parseReviewForm(form(values))).toBeNull()
  })
})

describe("parsePublishForm", () => {
  const all = [
    "no_personal_data",
    "region_matches",
    "category_complete",
    "label_checked",
  ]

  test("every checklist item is required", () => {
    expect(
      parsePublishForm(form({ issueId: ISSUE_ID, checklist: all.slice(1) })),
    ).toEqual({ errors: ["checklist"] })
    expect(
      parsePublishForm(form({ issueId: ISSUE_ID, checklist: all })),
    ).toEqual({ issueId: ISSUE_ID })
  })

  test("a missing issue id is a bad request", () => {
    expect(parsePublishForm(form({ checklist: all }))).toBeNull()
  })
})

const su = superuserPool()
const suDb = drizzle({ client: su })
const ids = { a: "", b: "", admin: "", editor: "", reporter: "" }
const CHECKLIST = [
  "no_personal_data",
  "region_matches",
  "category_complete",
  "label_checked",
]

function adminContext(role: MemberRole | null = "admin", userId = ids.admin) {
  const context = new RouterContextProvider()
  context.set(tenantContext, {
    id: ids.a,
    slug: "rva",
    host: "rva.localhost",
    name: "KM RVA",
    campusCode: "RVA",
    campusName: "Kampus RVA",
    theme: {},
    settings: {},
  })
  const session: SessionContext = {
    user: {
      id: userId,
      email: "admin.rva@contoh.id",
      emailVerified: true,
      phoneVerified: true,
      name: "",
      twoFactorEnabled: true,
      updatedAt: new Date(0),
    },
    session: {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  }
  context.set(sessionContext, session)
  context.set(staffContext, role ? { role } : null)
  return context
}

function args(code: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of [value].flat()) body.append(key, item)
  }
  return {
    request: new Request(`http://rva.localhost/kelola/x/${code}`, {
      method: "POST",
      body,
    }),
    context: adminContext(),
    params: { code },
  }
}

type Outcome = {
  status: number
  body: unknown
  location: string | null
  cache: string | null
}

/** What the caller observes. */
async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  let value: unknown
  try {
    value = await run()
  } catch (error) {
    if (error instanceof Error) throw error
    value = error
  }
  if (value instanceof Response) {
    return {
      status: value.status,
      body: null,
      location: value.headers.get("Location"),
      cache: value.headers.get("Cache-Control"),
    }
  }
  const wrapped = value as {
    type?: string
    data?: unknown
    init?: { status?: number; headers?: HeadersInit }
  }
  if (wrapped?.type === "DataWithResponseInit") {
    return {
      status: wrapped.init?.status ?? 200,
      body: wrapped.data,
      location: null,
      cache: new Headers(wrapped.init?.headers).get("Cache-Control"),
    }
  }
  return { status: 200, body: value, location: null, cache: null }
}

async function seedReport(
  status: ReportStatus,
  overrides: Partial<typeof reports.$inferInsert> = {},
) {
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(ids.a, ids.reporter, { status, ...overrides }))
    .returning({ id: reports.id, code: reports.publicCode })
  if (!row) throw new Error("report not inserted")
  return row
}

async function statusOf(reportId: string): Promise<string | undefined> {
  const { rows } = await su.query<{ status: string }>(
    "SELECT status FROM reports WHERE id = $1",
    [reportId],
  )
  return rows[0]?.status
}

/** Unpublished issue with one report. */
async function seedIssue() {
  const report = await seedReport("verified", { verifiedAt: new Date() })
  const merged = await runMerge(ids.a, {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Dago",
      summary: "Beberapa laporan menyebut atap kelas runtuh sejak sebulan.",
    },
    actorId: ids.admin,
    now: new Date(),
    notify: false,
  })
  if (!merged.ok) throw new Error("issue not merged")
  return { id: merged.issueId, code: merged.code, version: merged.version }
}

async function issueRow(id: string) {
  const { rows } = await su.query<{
    title: string
    version: number
    published: boolean
    taken_down: boolean
    advocacy_status: string
  }>(
    `SELECT title, version, published_at IS NOT NULL AS published,
       taken_down_at IS NOT NULL AS taken_down, advocacy_status
     FROM issues WHERE id = $1`,
    [id],
  )
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  ids.a = await insertOrg(su, "rva")
  ids.b = await insertOrg(su, "rvb")
  ids.admin = await insertUser(su, "admin.rva@contoh.id")
  ids.editor = await insertUser(su, "editor.rva@contoh.id")
  ids.reporter = await insertUser(su, "pelapor.rva@contoh.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'editor')",
    [ids.a, ids.admin, ids.editor],
  )
})

beforeEach(async () => {
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("reportPageAction", () => {
  test("Given an editor session, when it posts a decision, then 403", async () => {
    const report = await seedReport("submitted")
    const input = args(report.code, { intent: "start_review" })
    input.context = adminContext("editor", ids.editor)
    expect((await outcome(() => reportPageAction(input))).status).toBe(403)
    expect(await statusOf(report.id)).toBe("submitted")
  })

  test("Given a code of no report here, when posted, then 404", async () => {
    const result = await outcome(() =>
      reportPageAction(args("LPR-2026-10-9999", { intent: "start_review" })),
    )
    expect(result.status).toBe(404)
  })

  test("Given a reporter phone, when shown, then it is returned uncached and audited", async () => {
    const report = await seedReport("in_review")
    await su.query(
      "INSERT INTO report_contacts (org_id, report_id, phone, method) VALUES ($1, $2, '+6281234500001', 'whatsapp')",
      [ids.a, report.id],
    )
    const result = await outcome(() =>
      reportPageAction(args(report.code, { intent: "show_contact" })),
    )
    expect(result).toMatchObject({
      status: 200,
      body: {
        contact: { name: "", phone: "+6281234500001", method: "whatsapp" },
      },
      cache: "private, no-store",
    })
    const { rows } = await su.query(
      "SELECT actor_id FROM audit_log WHERE entity_id = $1 AND action = 'report.view_contact'",
      [report.id],
    )
    expect(rows).toEqual([{ actor_id: ids.admin }])
  })

  test("Given a reporter account, when shown, then it is returned uncached and audited", async () => {
    const report = await seedReport("in_review")
    const { rows: mine } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reports WHERE org_id = $1 AND user_id = $2",
      [ids.a, ids.reporter],
    )
    const result = await outcome(() =>
      reportPageAction(args(report.code, { intent: "show_account" })),
    )
    expect(result).toMatchObject({
      status: 200,
      body: {
        account: { email: "pelapor.rva@contoh.id", reports: mine[0]?.n },
      },
      cache: "private, no-store",
    })
    const { rows } = await su.query(
      "SELECT actor_id FROM audit_log WHERE entity_id = $1 AND action = 'report.view_account'",
      [report.id],
    )
    expect(rows).toEqual([{ actor_id: ids.admin }])
  })

  test("Given an unknown intent, when posted, then 400 and nothing changes", async () => {
    const report = await seedReport("submitted")
    const result = await outcome(() =>
      reportPageAction(args(report.code, { intent: "delete" })),
    )
    expect(result.status).toBe(400)
    expect(await statusOf(report.id)).toBe("submitted")
  })

  test("Given a reject without a standard, when posted, then 400 names the fields", async () => {
    const report = await seedReport("in_review")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, { intent: "reject", from: "in_review" }),
      ),
    )
    expect(result).toMatchObject({
      status: 400,
      body: { errors: ["reject_reason", "reject_text"], intent: "reject" },
    })
    expect(await statusOf(report.id)).toBe("in_review")
  })

  test("Given a submitted report, when review starts, then it moves and the page reloads", async () => {
    const report = await seedReport("submitted")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, { intent: "start_review", from: "submitted" }),
      ),
    )
    expect(result).toMatchObject({
      status: 303,
      location: `/kelola/laporan/${report.code}`,
    })
    expect(await statusOf(report.id)).toBe("in_review")
  })

  test("Given another admin moved the report, when a stale decision posts, then 409", async () => {
    const report = await seedReport("in_review")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, { intent: "start_review", from: "submitted" }),
      ),
    )
    expect(result).toMatchObject({ status: 409, body: { conflict: true } })
    expect(await statusOf(report.id)).toBe("in_review")
  })

  test("Given a reporter who refused contact, when verified by contact, then 400", async () => {
    const report = await seedReport("in_review", { contactable: false })
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, {
          intent: "verify",
          from: "in_review",
          method: "reporter_contact",
        }),
      ),
    )
    expect(result).toMatchObject({
      status: 400,
      body: { errors: ["verify_contact"], intent: "verify" },
    })
    expect(await statusOf(report.id)).toBe("in_review")
  })

  test("Given a verified report, when merged into a new issue, then it opens the issue", async () => {
    const report = await seedReport("verified", { verifiedAt: new Date() })
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, {
          intent: "merge",
          target: "new",
          title: "Atap sekolah runtuh di Dago",
          summary: "Beberapa laporan menyebut atap kelas runtuh.",
        }),
      ),
    )
    const { rows } = await su.query<{ code: string }>(
      "SELECT i.public_code AS code FROM issues i JOIN issue_reports ir ON ir.issue_id = i.id WHERE ir.report_id = $1",
      [report.id],
    )
    expect(rows).toHaveLength(1)
    expect(result).toMatchObject({
      status: 303,
      location: `/kelola/isu/${rows[0]?.code}`,
    })
    expect(await statusOf(report.id)).toBe("merged")
  })

  test("Given a published issue, when a report joins it, then it opens that issue", async () => {
    const issue = await seedIssue()
    await su.query("UPDATE issues SET published_at = now() WHERE id = $1", [
      issue.id,
    ])
    const report = await seedReport("verified", { verifiedAt: new Date() })
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, {
          intent: "merge",
          target: "existing",
          issueId: issue.id,
        }),
      ),
    )
    expect(result).toMatchObject({
      status: 303,
      location: `/kelola/isu/${issue.code}`,
    })
    expect(await statusOf(report.id)).toBe("merged")
  })

  test("Given an issue that does not exist, when merged into, then 400 merge_issue", async () => {
    const report = await seedReport("verified", { verifiedAt: new Date() })
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, {
          intent: "merge",
          target: "existing",
          issueId: crypto.randomUUID(),
        }),
      ),
    )
    expect(result).toMatchObject({
      status: 400,
      body: { errors: ["merge_issue"], intent: "merge" },
    })
    expect(await statusOf(report.id)).toBe("verified")
  })

  test("Given a report still in review, when merged, then 409", async () => {
    const report = await seedReport("in_review")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, {
          intent: "merge",
          target: "new",
          title: "Atap sekolah runtuh di Dago",
          summary: "Beberapa laporan menyebut atap kelas runtuh.",
        }),
      ),
    )
    expect(result).toMatchObject({ status: 409, body: { conflict: true } })
    expect(await statusOf(report.id)).toBe("in_review")
  })

  test("Given another campus, when the report is forwarded, then a copy is in review there", async () => {
    const report = await seedReport("submitted")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, { intent: "forward", targetOrgId: ids.b }),
      ),
    )
    expect(result).toMatchObject({
      status: 303,
      location: `/kelola/laporan/${report.code}`,
    })
    expect(await statusOf(report.id)).toBe("forwarded")
    const { rows } = await su.query(
      "SELECT status FROM reports WHERE org_id = $1 AND forwarded_from_report_id = $2",
      [ids.b, report.id],
    )
    expect(rows).toEqual([{ status: "in_review" }])
  })

  test("Given an unknown campus, when forwarded, then 400 forward_target", async () => {
    const report = await seedReport("submitted")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, {
          intent: "forward",
          targetOrgId: crypto.randomUUID(),
        }),
      ),
    )
    expect(result).toMatchObject({
      status: 400,
      body: { errors: ["forward_target"], intent: "forward" },
    })
    expect(await statusOf(report.id)).toBe("submitted")
  })

  test("Given a rejected report, when forwarded, then 409", async () => {
    const report = await seedReport("rejected")
    const result = await outcome(() =>
      reportPageAction(
        args(report.code, { intent: "forward", targetOrgId: ids.b }),
      ),
    )
    expect(result).toMatchObject({ status: 409, body: { conflict: true } })
    expect(await statusOf(report.id)).toBe("rejected")
  })
})

describe("issuePageAction", () => {
  const seen = (version: number) => ({
    advocacy: "monitoring",
    government: "awaiting_response",
    version: String(version),
  })

  test("Given a code of no issue here, when posted, then 404", async () => {
    const result = await outcome(() =>
      issuePageAction(args("ISU-2026-10-9999", { intent: "publish" })),
    )
    expect(result.status).toBe(404)
  })

  test("Given an unticked checklist, when published, then 400 and still a draft", async () => {
    const issue = await seedIssue()
    const result = await outcome(() =>
      issuePageAction(
        args(issue.code, {
          intent: "publish",
          issueId: issue.id,
          checklist: CHECKLIST.slice(1),
        }),
      ),
    )
    expect(result).toMatchObject({
      status: 400,
      body: { errors: ["checklist"], intent: "publish" },
    })
    expect((await issueRow(issue.id))?.published).toBe(false)
  })

  test("Given a missing or foreign issue id, when published, then 400", async () => {
    const issue = await seedIssue()
    const other = await seedIssue()
    for (const issueId of ["", other.id]) {
      const result = await outcome(() =>
        issuePageAction(
          args(issue.code, {
            intent: "publish",
            issueId,
            checklist: CHECKLIST,
          }),
        ),
      )
      expect(result.status).toBe(400)
    }
    expect((await issueRow(other.id))?.published).toBe(false)
  })

  test("Given a ticked checklist, when published, then public, a second try 409", async () => {
    const issue = await seedIssue()
    const publish = () =>
      outcome(() =>
        issuePageAction(
          args(issue.code, {
            intent: "publish",
            issueId: issue.id,
            checklist: CHECKLIST,
          }),
        ),
      )
    expect(await publish()).toMatchObject({
      status: 303,
      location: `/kelola/isu/${issue.code}`,
    })
    expect((await issueRow(issue.id))?.published).toBe(true)
    expect(await publish()).toMatchObject({
      status: 409,
      body: { conflict: true },
    })
  })

  const edit = (version: number, title: string) => ({
    intent: "edit",
    title,
    summary: "Beberapa laporan menyebut atap kelas runtuh sejak sebulan.",
    subcategoryId: "program.pendidikan",
    regencyCode: "32.73",
    version: String(version),
  })

  test("Given an edit form, when posted, then each outcome maps to its answer", async () => {
    const issue = await seedIssue()
    const post = (fields: Record<string, string>) =>
      outcome(() => issuePageAction(args(issue.code, fields)))
    expect(
      (await post({ ...edit(issue.version, "Atap"), version: "0" })).status,
    ).toBe(400)
    expect(await post(edit(issue.version, "Atap"))).toMatchObject({
      status: 400,
      body: { errors: ["edit_title"], intent: "edit" },
    })
    expect(
      await post(edit(issue.version, "Atap sekolah runtuh di Dago")),
    ).toMatchObject({ status: 200, body: { unchanged: true } })
    expect(
      await post(edit(issue.version, "Atap ruang kelas runtuh di Dago")),
    ).toMatchObject({ status: 303, location: `/kelola/isu/${issue.code}` })
    expect((await issueRow(issue.id))?.title).toBe(
      "Atap ruang kelas runtuh di Dago",
    )
    expect(
      await post(edit(issue.version, "Judul lain dari versi lama")),
    ).toMatchObject({ status: 409, body: { conflict: true } })
  })

  test("Given a legal order form, when posted, then each outcome maps to its answer", async () => {
    const issue = await seedIssue()
    const post = (fields: Record<string, string>) =>
      outcome(() =>
        issuePageAction(
          args(issue.code, { intent: "legal_takedown", ...fields }),
        ),
      )
    expect((await post({ decision: "remove" })).status).toBe(400)
    expect(
      await post({ decision: "x", version: String(issue.version) }),
    ).toMatchObject({
      status: 400,
      body: {
        errors: ["legal_decision", "legal_reason", "legal_confirm"],
        intent: "legal_takedown",
      },
    })
    const order = {
      decision: "remove",
      reason: "komdigi_order",
      confirm: "yes",
    }
    expect(
      await post({ ...order, version: String(issue.version + 1) }),
    ).toMatchObject({ status: 409, body: { conflict: true } })
    expect((await issueRow(issue.id))?.taken_down).toBe(false)
    expect(
      await post({ ...order, version: String(issue.version) }),
    ).toMatchObject({ status: 303, location: `/kelola/isu/${issue.code}` })
    expect((await issueRow(issue.id))?.taken_down).toBe(true)
  })

  test("Given a referral form, when posted, then each outcome maps to its answer", async () => {
    const issue = await seedIssue()
    await su.query("UPDATE issues SET published_at = now() WHERE id = $1", [
      issue.id,
    ])
    const refer = {
      intent: "refer",
      agency: "Dinas Pendidikan Kota Bandung",
      channel: "agency_service",
      ticket: "TIKET-2026-0042",
      sentOn: "2026-10-12",
      deadlineOn: "2026-10-26",
    }
    const post = (fields: Record<string, string>) =>
      outcome(() => issuePageAction(args(issue.code, fields)))
    expect((await post({ intent: "refer" })).status).toBe(400)
    expect(
      await post({ ...seen(issue.version), ...refer, agency: "" }),
    ).toMatchObject({
      status: 400,
      body: { errors: ["agency"], intent: "refer" },
    })
    expect(await post({ ...seen(issue.version + 1), ...refer })).toMatchObject({
      status: 409,
      body: { conflict: true },
    })
    expect(await post({ ...seen(issue.version), ...refer })).toMatchObject({
      status: 303,
      location: `/kelola/isu/${issue.code}#riwayat`,
    })
    expect((await issueRow(issue.id))?.advocacy_status).toBe("referred")
  })
})

describe("closeAccountAction", () => {
  test("Given no reason and no confirmation, when posted, then 400 names both", async () => {
    const report = await seedReport("submitted")
    const result = await outcome(() =>
      closeAccountAction(args(report.code, {})),
    )
    expect(result).toMatchObject({
      status: 400,
      body: { errors: ["close_reason", "close_confirm"] },
    })
    expect(await statusOf(report.id)).toBe("submitted")
  })

  test("Given a code of no report here, when posted, then 404", async () => {
    const result = await outcome(() =>
      closeAccountAction(
        args("LPR-2026-10-9999", { reason: "self_declared", confirm: "yes" }),
      ),
    )
    expect(result.status).toBe(404)
  })

  test("Given the admin's own report, when closing, then 403 and it stays", async () => {
    const [own] = await suDb
      .insert(reports)
      .values(reportValues(ids.a, ids.admin))
      .returning({ id: reports.id, code: reports.publicCode })
    if (!own) throw new Error("report not inserted")
    const result = await outcome(() =>
      closeAccountAction(
        args(own.code, { reason: "self_declared", confirm: "yes" }),
      ),
    )
    expect(result.status).toBe(403)
    expect(await statusOf(own.id)).toBe("submitted")
  })

  test("Given a reporter's report, when closing confirmed, then their reports here are gone", async () => {
    const user = await insertUser(su, "tutup.rva@contoh.id")
    const make = async () => {
      const [row] = await suDb
        .insert(reports)
        .values(reportValues(ids.a, user))
        .returning({ id: reports.id, code: reports.publicCode })
      if (!row) throw new Error("report not inserted")
      return row
    }
    const first = await make()
    const second = await make()
    const result = await outcome(() =>
      closeAccountAction(
        args(first.code, { reason: "self_declared", confirm: "yes" }),
      ),
    )
    expect(result).toEqual({
      status: 200,
      body: { done: { reports: 2, issues: [], unpublished: [] } },
      location: null,
      cache: null,
    })
    expect(await statusOf(first.id)).toBeUndefined()
    expect(await statusOf(second.id)).toBeUndefined()
  })
})
