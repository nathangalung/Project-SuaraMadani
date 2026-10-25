import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { RouterContextProvider } from "react-router"
import { migrate } from "../../../db/migrate.ts"
import type { MemberRole } from "../../../db/schema/auth.ts"
import { redactionOriginals } from "../../../db/schema/moderation.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
import { pgError, withTenant } from "../../../db/tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import type { PurgeClient } from "../../../server/purge.server.ts"
import { staffContext } from "../../../server/request-context.server.ts"
import { sessionContext, tenantContext } from "../../context.ts"
import { runPublish } from "../issues/publish.server.ts"
import { complaintPageAction } from "./complaint-actions.server.ts"
import {
  countWaitingComplaints,
  type DecideInput,
  decideComplaint,
  getComplaint,
  listComplaints,
} from "./complaints.server.ts"
import { legalTakedown } from "./legal-takedown.server.ts"
import { runMerge } from "./merge.server.ts"

process.env.AUDIT_HMAC_KEY ||= Buffer.alloc(32, 7).toString("base64")

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
const NO_PURGE: PurgeClient = {
  purgeUrls: async () => ({ skipped: true }),
  purgeHosts: async () => ({ skipped: true }),
}
const SECRET = "Jalan Melati 12 rumah Bu Sari"
const orgs = { a: "", b: "" }
let first = ""
let second = ""
let complainant = ""

const tenant = (org: "a" | "b") => ({
  id: orgs[org],
  host: `cm${org}.localhost`,
})

type Seeded = {
  issueId: string
  code: string
  complaintId: string
  version: number
  evidenceId: string
}

async function seed(org: "a" | "b" = "a"): Promise<Seeded> {
  const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(orgs[org], reporter, {
        status: "verified",
        verifiedAt: NOW,
      }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(orgs[org], {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: `Warga di ${SECRET} melaporkan atap kelas runtuh.`,
    },
    actorId: first,
    now: NOW,
    notify: false,
  })
  if (!merged.ok) throw new Error(merged.reason)
  await runPublish(
    tenant(org),
    { issueId: merged.issueId, actorId: first, notify: false },
    { purge: NO_PURGE },
  )
  const [file] = await suDb
    .insert(evidence)
    .values({
      orgId: orgs[org],
      reportId: report.id,
      position: 0,
      kind: "image",
      declaredName: "a.jpg",
      declaredType: "image/jpeg",
      declaredSize: 10,
      status: "published",
      decision: "no_redaction",
      decidedAt: NOW,
      publishedAt: NOW,
      publicMedia: [
        {
          type: "image",
          file: `${"a".repeat(63)}${org}.webp`,
          page: 0,
          width: 10,
          height: 10,
        },
      ],
    })
    .returning({ id: evidence.id })
  if (!file) throw new Error("no evidence")
  const { rows } = await su.query<{ id: string; version: number }>(
    `INSERT INTO content_complaints
       (org_id, issue_id, public_code, user_id, submission_id, reason, part, explanation)
     VALUES ($1, $2, $3, $4, gen_random_uuid(), 'personal_data', 'title_summary',
       'Ringkasan isu menyebut alamat rumah seorang warga.')
     RETURNING id, (SELECT version FROM issues WHERE id = $2) AS version`,
    [
      orgs[org],
      merged.issueId,
      `ADU-CM${org.toUpperCase()}-26-${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
      complainant,
    ],
  )
  const row = rows[0]
  if (!row) throw new Error("no complaint")
  return {
    issueId: merged.issueId,
    code: merged.code,
    complaintId: row.id,
    version: row.version,
    evidenceId: file.id,
  }
}

function input(s: Seeded, overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    complaintId: s.complaintId,
    stage: "first",
    decision: "keep",
    reason: "no_violation",
    statement: "Isu ini tidak memuat data pribadi yang bisa dikenali.",
    actorId: first,
    subjectVersion: s.version,
    notify: true,
    ...overrides,
  }
}

async function complaintRow(id: string) {
  const { rows } = await su.query(
    "SELECT status, decision, decided_by, appeal_decision, appeal_decided_by FROM content_complaints WHERE id = $1",
    [id],
  )
  return rows[0]
}

async function issueRow(id: string) {
  const { rows } = await su.query<{
    title: string
    summary: string
    published_at: Date | null
    taken_down_at: Date | null
    redaction_reason: string | null
    version: number
  }>(
    "SELECT title, summary, published_at, taken_down_at, redaction_reason, version FROM issues WHERE id = $1",
    [id],
  )
  return rows[0]
}

async function takedownRows(complaintId: string) {
  const { rows } = await su.query<{
    action: string
    purge_status: string
    public_files: { file: string; store: string }[]
  }>(
    "SELECT action, purge_status, public_files FROM takedowns WHERE complaint_id = $1",
    [complaintId],
  )
  return rows
}

async function appeal(id: string) {
  await su.query(
    `UPDATE content_complaints SET status = 'appealed',
       appeal_text = 'Alamat itu masih terlihat di ringkasan isu.', appealed_at = now()
     WHERE id = $1`,
    [id],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgs.a = await insertOrg(su, "cma")
  orgs.b = await insertOrg(su, "cmb")
  first = await insertUser(su, "moderator.satu@contoh.id")
  second = await insertUser(su, "moderator.dua@contoh.id")
  complainant = await insertUser(su, "pengadu.mod@contoh.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter')",
    [orgs.a, complainant],
  )
})

beforeEach(async () => {
  for (const table of [
    "takedowns",
    "content_complaints",
    "evidence",
    "issue_reports",
    "issues",
    "org_counters",
    "reports",
  ]) {
    await su.query(`DELETE FROM ${table}`)
  }
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('email-send', 'takedown')",
  )
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("decideComplaint", () => {
  test("keep records reasons and tells the complainant", async () => {
    const s = await seed()
    const result = await decideComplaint(tenant("a"), input(s))
    expect(result).toEqual({ ok: true })
    expect(await complaintRow(s.complaintId)).toMatchObject({
      status: "decided",
      decision: "keep",
      decided_by: first,
    })
    const { rows } = await su.query(
      `SELECT n.template, a.action, a.reason_code FROM notifications n
       JOIN audit_log a ON a.id = n.event_id WHERE n.complaint_id = $1`,
      [s.complaintId],
    )
    expect(rows).toEqual([
      {
        template: "complaint_decided",
        action: "complaint.decide",
        reason_code: "no_violation",
      },
    ])
    expect(await takedownRows(s.complaintId)).toEqual([])
    expect((await issueRow(s.issueId))?.version).toBe(s.version)
  })

  test("edit redacts in place, originals stay private", async () => {
    const s = await seed()
    const summary = "Warga melaporkan atap kelas runtuh di Coblong."
    const result = await decideComplaint(
      tenant("a"),
      input(s, {
        decision: "edit",
        reason: "standard_11",
        edit: {
          title: "Atap sekolah runtuh di Coblong",
          summary,
          withdraw: [s.evidenceId],
        },
      }),
    )
    expect(result).toEqual({ ok: true })
    const issue = await issueRow(s.issueId)
    expect(issue).toMatchObject({
      summary,
      redaction_reason: "standard_11",
      version: s.version + 1,
    })
    expect(issue?.published_at).not.toBeNull()
    const [takedown] = await takedownRows(s.complaintId)
    expect(takedown?.action).toBe("redact")
    expect(takedown?.public_files).toEqual([
      { file: `${"a".repeat(63)}a.webp`, store: "local" },
    ])
    const file = await su.query(
      "SELECT status, decision, public_media, published_at FROM evidence WHERE id = $1",
      [s.evidenceId],
    )
    expect(file.rows[0]).toEqual({
      status: "ready",
      decision: "withhold",
      public_media: null,
      published_at: null,
    })
    const jobs = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'takedown'",
    )
    expect(jobs.rowCount).toBe(1)
    // Only one table keeps it
    const { rows } = await su.query<{ hits: string[] }>(
      `SELECT array_agg(DISTINCT c.relname::text) AS hits
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL (
         SELECT 1 FROM ROWS FROM (
           query_to_xml(format('SELECT * FROM public.%I', c.relname), false, false, '')
         ) AS x(doc) WHERE doc::text LIKE '%' || $1 || '%'
       ) found
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      [SECRET],
    )
    expect(rows[0]?.hits).toEqual(["redaction_originals"])
    const audit = await su.query<{ changed: string[]; hashes: object }>(
      `SELECT changed_columns AS changed, value_hashes AS hashes
       FROM audit_log WHERE action = 'issue.redact' AND entity_id = $1`,
      [s.issueId],
    )
    expect(audit.rows[0]?.changed).toEqual(["summary", "evidence"])
    expect(JSON.stringify(audit.rows[0]?.hashes)).toMatch(/[0-9a-f]{64}/)
  })

  test("reporters cannot read redaction originals", async () => {
    const s = await seed()
    await decideComplaint(
      tenant("a"),
      input(s, {
        decision: "edit",
        reason: "standard_11",
        edit: {
          title: "Atap sekolah runtuh di Coblong",
          summary: "Warga melaporkan atap kelas runtuh di Coblong.",
          withdraw: [],
        },
      }),
    )
    const read = (role: "reporter" | "admin") =>
      withTenant(
        orgs.a,
        (tx) =>
          tx
            .select({ original: redactionOriginals.original })
            .from(redactionOriginals)
            .where(eq(redactionOriginals.issueId, s.issueId)),
        { role },
      )
    expect(await read("reporter")).toEqual([])
    expect((await read("admin")).length).toBe(1)
  })

  test("hide unpublishes, withdraws copies, can publish again", async () => {
    const s = await seed()
    const result = await decideComplaint(
      tenant("a"),
      input(s, { decision: "hide", reason: "standard_3" }),
    )
    expect(result).toEqual({ ok: true })
    expect((await issueRow(s.issueId))?.published_at).toBeNull()
    const [takedown] = await takedownRows(s.complaintId)
    expect(takedown).toMatchObject({
      action: "unpublish",
      purge_status: "pending",
    })
    const file = await su.query(
      "SELECT status, decision FROM evidence WHERE id = $1",
      [s.evidenceId],
    )
    // Decision kept for republish
    expect(file.rows[0]).toEqual({ status: "ready", decision: "no_redaction" })
    const again = await runPublish(
      tenant("a"),
      { issueId: s.issueId, actorId: first, notify: false },
      { purge: NO_PURGE },
    )
    expect(again.ok).toBe(true)
  })

  test("remove takes the issue down for good", async () => {
    const s = await seed()
    const result = await decideComplaint(
      tenant("a"),
      input(s, { decision: "remove", reason: "standard_8" }),
    )
    expect(result).toEqual({ ok: true })
    const issue = await issueRow(s.issueId)
    expect(issue?.published_at).toBeNull()
    expect(issue?.taken_down_at).not.toBeNull()
    expect((await takedownRows(s.complaintId))[0]?.action).toBe("take_down")
    const again = await runPublish(
      tenant("a"),
      { issueId: s.issueId, actorId: first, notify: false },
      { purge: NO_PURGE },
    )
    expect(again).toEqual({ ok: false, reason: "changed" })
  })

  test("a reason must fit the decision", async () => {
    const s = await seed()
    const result = await decideComplaint(
      tenant("a"),
      input(s, { decision: "remove", reason: "no_violation" }),
    )
    expect(result).toEqual({ ok: false, reason: "not_allowed" })
  })

  test("a stale issue version changes nothing", async () => {
    const s = await seed()
    const result = await decideComplaint(
      tenant("a"),
      input(s, {
        decision: "hide",
        reason: "standard_3",
        subjectVersion: s.version - 1,
      }),
    )
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
  })

  test("two admins at once, one decision", async () => {
    const s = await seed()
    const results = await Promise.all([
      decideComplaint(tenant("a"), input(s)),
      decideComplaint(
        tenant("a"),
        input(s, { actorId: second, decision: "hide", reason: "standard_3" }),
      ),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE action = 'complaint.decide' AND entity_id = $1",
      [s.complaintId],
    )
    expect(audit.rowCount).toBe(1)
  })

  test("a second decision of the same stage is refused", async () => {
    const s = await seed()
    await decideComplaint(tenant("a"), input(s))
    const again = await decideComplaint(
      tenant("a"),
      input(s, { actorId: second }),
    )
    expect(again).toEqual({ ok: false, reason: "changed" })
  })
})

describe("refused effects", () => {
  test("Given an issue already taken down, when a complaint decides hide, then not_allowed and the complaint stays open", async () => {
    const s = await seed()
    await legalTakedown(tenant("a"), {
      issueId: s.issueId,
      version: s.version,
      decision: "remove",
      reason: "komdigi_order",
      actorId: first,
    })
    const result = await decideComplaint(
      tenant("a"),
      input(s, {
        decision: "hide",
        reason: "standard_3",
        subjectVersion: s.version + 1,
      }),
    )
    expect(result).toEqual({ ok: false, reason: "not_allowed" })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
    const { rows } = await su.query(
      "SELECT 1 FROM audit_log WHERE entity_id = $1",
      [s.complaintId],
    )
    expect(rows).toEqual([])
  })
})

describe("countWaitingComplaints", () => {
  test("Given open and appealed complaints on two campuses, when counted, then only this campus's waiting ones", async () => {
    await seed()
    await seed()
    const decided = await seed()
    await decideComplaint(tenant("a"), input(decided))
    const appealed = await seed()
    await decideComplaint(tenant("a"), input(appealed))
    await appeal(appealed.complaintId)
    await seed("b")
    expect(await countWaitingComplaints(orgs.a, "admin")).toEqual({
      open: 2,
      appealed: 1,
    })
  })

  test("Given no complaints, when counted, then zeros", async () => {
    expect(await countWaitingComplaints(orgs.a, "admin")).toEqual({
      open: 0,
      appealed: 0,
    })
  })
})

describe("complaintPageAction", () => {
  function context(actorId: string, role: MemberRole = "admin") {
    const provider = new RouterContextProvider()
    provider.set(tenantContext, {
      id: orgs.a,
      slug: "cma",
      host: "cma.localhost",
      name: "KM CMA",
      campusCode: "CMA",
      campusName: "Kampus CMA",
      theme: {},
      settings: {},
    })
    provider.set(sessionContext, {
      user: {
        id: actorId,
        email: "moderator@contoh.id",
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
    })
    provider.set(staffContext, { role })
    return provider
  }

  async function codeOf(complaintId: string): Promise<string> {
    const { rows } = await su.query<{ public_code: string }>(
      "SELECT public_code FROM content_complaints WHERE id = $1",
      [complaintId],
    )
    return rows[0]?.public_code ?? ""
  }

  /** Status, body and Location. */
  async function post(
    code: string,
    fields: Record<string, string>,
    actorId = first,
    role: MemberRole = "admin",
  ) {
    let value: unknown
    try {
      value = await complaintPageAction({
        request: new Request(`http://cma.localhost/kelola/aduan/${code}`, {
          method: "POST",
          body: new URLSearchParams(fields),
        }),
        context: context(actorId, role),
        params: { code },
      })
    } catch (error) {
      if (error instanceof Error) throw error
      value = error
    }
    if (value instanceof Response) {
      return {
        status: value.status,
        location: value.headers.get("Location"),
      }
    }
    const wrapped = value as { data?: unknown; init?: { status?: number } }
    return { status: wrapped.init?.status ?? 200, body: wrapped.data }
  }

  const keep = (version: number, stage = "first") => ({
    intent: "keep",
    stage,
    subjectVersion: String(version),
    reason: "no_violation",
    statement: "Isu ini tidak memuat data pribadi yang bisa dikenali.",
  })

  test("Given an editor, when deciding, then 403 and the complaint stays open", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    expect(await post(code, keep(s.version), first, "editor")).toMatchObject({
      status: 403,
    })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
  })

  test("Given a code of no complaint here, when deciding, then 404", async () => {
    expect(await post("ADU-CMA-26-NONE0", keep(1))).toMatchObject({
      status: 404,
    })
  })

  test("Given a form without a decision, when posted, then 400", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    expect(await post(code, { stage: "first" })).toMatchObject({
      status: 400,
    })
  })

  test("Given a hide without reason or confirmation, when posted, then 400 names them", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    expect(
      await post(code, {
        intent: "hide",
        stage: "first",
        subjectVersion: String(s.version),
        statement: "Ringkasan memuat alamat rumah warga yang dikenali.",
      }),
    ).toEqual({
      status: 400,
      body: { decision: "hide", errors: ["decision_reason", "confirm"] },
    })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
  })

  test("Given a keep decision, when posted, then decided and back to the decision", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    expect(await post(code, keep(s.version))).toEqual({
      status: 303,
      location: `/kelola/aduan/${code}#keputusan`,
    })
    expect(await complaintRow(s.complaintId)).toMatchObject({
      status: "decided",
      decided_by: first,
    })
  })

  test("Given a stale issue version, when posted, then 409", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    expect(await post(code, keep(s.version - 1))).toEqual({
      status: 409,
      body: { conflict: true },
    })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
  })

  test("Given the first admin, when deciding the appeal, then 403 sameAdmin", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    await decideComplaint(tenant("a"), input(s))
    await appeal(s.complaintId)
    expect(await post(code, keep(s.version, "appeal"))).toEqual({
      status: 403,
      body: { sameAdmin: true },
    })
    expect((await complaintRow(s.complaintId))?.status).toBe("appealed")
  })

  test("Given an issue already taken down, when hide is posted, then 400 notAllowed", async () => {
    const s = await seed()
    const code = await codeOf(s.complaintId)
    await legalTakedown(tenant("a"), {
      issueId: s.issueId,
      version: s.version,
      decision: "remove",
      reason: "komdigi_order",
      actorId: first,
    })
    expect(
      await post(code, {
        intent: "hide",
        stage: "first",
        subjectVersion: String(s.version + 1),
        reason: "standard_3",
        statement: "Ringkasan memuat alamat rumah warga yang dikenali.",
        confirm: "yes",
      }),
    ).toEqual({ status: 400, body: { notAllowed: "hide" } })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
  })
})

describe("appeal decisions", () => {
  test("the first admin cannot decide the appeal", async () => {
    const s = await seed()
    await decideComplaint(tenant("a"), input(s))
    await appeal(s.complaintId)
    const same = await decideComplaint(
      tenant("a"),
      input(s, { stage: "appeal" }),
    )
    expect(same).toEqual({ ok: false, reason: "same_admin" })
    const other = await decideComplaint(
      tenant("a"),
      input(s, {
        stage: "appeal",
        actorId: second,
        decision: "hide",
        reason: "standard_11",
      }),
    )
    expect(other).toEqual({ ok: true })
    expect(await complaintRow(s.complaintId)).toMatchObject({
      status: "appeal_decided",
      decided_by: first,
      appeal_decision: "hide",
      appeal_decided_by: second,
    })
    expect((await issueRow(s.issueId))?.published_at).toBeNull()
    const notes = await su.query(
      "SELECT template FROM notifications WHERE complaint_id = $1 ORDER BY created_at",
      [s.complaintId],
    )
    expect(notes.rows.map((r) => r.template)).toEqual([
      "complaint_decided",
      "complaint_appeal_decided",
    ])
  })

  test("SQL refuses the same admin on appeal", async () => {
    const s = await seed()
    await decideComplaint(tenant("a"), input(s))
    await appeal(s.complaintId)
    let code: string | undefined
    try {
      await su.query(
        `UPDATE content_complaints SET status = 'appeal_decided',
           appeal_decision = 'keep', appeal_reason = 'no_violation',
           appeal_decision_text = 'Keputusan pertama sudah tepat dan tetap berlaku.',
           appeal_decided_by = decided_by, appeal_decided_at = now()
         WHERE id = $1`,
        [s.complaintId],
      )
    } catch (error) {
      code = pgError(error)?.code
    }
    expect(code).toBe("23514")
  })

  test("an appeal stage needs an appealed complaint", async () => {
    const s = await seed()
    const result = await decideComplaint(
      tenant("a"),
      input(s, { stage: "appeal", actorId: second }),
    )
    expect(result).toEqual({ ok: false, reason: "changed" })
  })
})

describe("tenant isolation", () => {
  test("another campus cannot read or decide", async () => {
    const s = await seed("a")
    const crossed = await decideComplaint(tenant("b"), input(s))
    expect(crossed).toEqual({ ok: false, reason: "not_found" })
    expect((await complaintRow(s.complaintId))?.status).toBe("open")
    const found = await su.query<{ public_code: string }>(
      "SELECT public_code FROM content_complaints WHERE id = $1",
      [s.complaintId],
    )
    const code = found.rows[0]?.public_code ?? ""
    expect(await getComplaint(orgs.b, "admin", code)).toBeNull()
    expect(await listComplaints(orgs.b, "admin", "baru")).toEqual([])
    const own = await listComplaints(orgs.a, "admin", "baru")
    expect(own.map((row) => row.code)).toEqual([code])
  })
})

describe("getComplaint", () => {
  test("Given takedowns from two complaints and a legal order, when one complaint is opened, then only its own takedown is listed", async () => {
    const hidden = await seed()
    const removed = await seed()
    const ordered = await seed()
    for (const [s, decision, reason] of [
      [hidden, "hide", "standard_3"],
      [removed, "remove", "standard_8"],
    ] as const) {
      expect(
        await decideComplaint(tenant("a"), input(s, { decision, reason })),
      ).toEqual({ ok: true })
    }
    expect(
      await legalTakedown(tenant("a"), {
        issueId: ordered.issueId,
        version: ordered.version,
        decision: "remove",
        reason: "komdigi_order",
        actorId: first,
      }),
    ).toEqual({ ok: true })
    const { rows } = await su.query<{ public_code: string }>(
      "SELECT public_code FROM content_complaints WHERE id = $1",
      [hidden.complaintId],
    )
    const detail = await getComplaint(
      orgs.a,
      "admin",
      rows[0]?.public_code ?? "",
    )
    expect(detail?.takedowns).toEqual([
      {
        id: expect.any(String),
        action: "unpublish",
        purgeStatus: "pending",
        createdAt: expect.any(Date),
        doneAt: null,
      },
    ])
  })
})

describe("legal takedown, PLAN §5.10", () => {
  test("a Komdigi order takes the issue down, no complaint", async () => {
    const s = await seed()
    const result = await legalTakedown(tenant("a"), {
      issueId: s.issueId,
      version: s.version,
      decision: "remove",
      reason: "komdigi_order",
      actorId: first,
    })
    expect(result).toEqual({ ok: true })
    const issue = await issueRow(s.issueId)
    expect(issue?.published_at).toBeNull()
    expect(issue?.taken_down_at).not.toBeNull()
    const { rows } = await su.query(
      `SELECT t.action, t.complaint_id, t.public_files, i.takedown_reason
       FROM takedowns t JOIN issues i ON i.id = t.issue_id WHERE t.issue_id = $1`,
      [s.issueId],
    )
    expect(rows).toEqual([
      {
        action: "take_down",
        complaint_id: null,
        public_files: [{ file: `${"a".repeat(63)}a.webp`, store: "local" }],
        takedown_reason: "komdigi_order",
      },
    ])
    const { rows: audit } = await su.query(
      "SELECT action, reason_code FROM audit_log WHERE entity_id = $1 AND action LIKE 'issue.take%'",
      [s.issueId],
    )
    expect(audit).toEqual([
      { action: "issue.take_down", reason_code: "komdigi_order" },
    ])
  })

  test("a data owner's request hides the issue", async () => {
    const s = await seed()
    expect(
      await legalTakedown(tenant("a"), {
        issueId: s.issueId,
        version: s.version,
        decision: "hide",
        reason: "data_subject_request",
        actorId: first,
      }),
    ).toEqual({ ok: true })
    const issue = await issueRow(s.issueId)
    expect(issue?.published_at).toBeNull()
    expect(issue?.taken_down_at).toBeNull()
  })

  test("stale versions and hidden issues are refused", async () => {
    const s = await seed()
    const base = {
      issueId: s.issueId,
      decision: "hide" as const,
      reason: "komdigi_order" as const,
      actorId: first,
    }
    expect(
      await legalTakedown(tenant("a"), { ...base, version: s.version - 1 }),
    ).toEqual({ ok: false, reason: "changed" })
    expect(
      await legalTakedown(tenant("a"), { ...base, version: s.version }),
    ).toEqual({ ok: true })
    // Already hidden, version moved
    expect(
      await legalTakedown(tenant("a"), { ...base, version: s.version + 1 }),
    ).toEqual({ ok: false, reason: "not_allowed" })
    // Another campus reads nothing
    expect(
      await legalTakedown(tenant("b"), { ...base, version: s.version + 1 }),
    ).toEqual({ ok: false, reason: "not_found" })
  })
})
