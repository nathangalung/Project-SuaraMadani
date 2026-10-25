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
import { evidence, reports } from "../../../db/schema/reports.ts"
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
import { runPublish } from "../issues/publish.server.ts"
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
const orgs = { a: "", b: "" }
let admin = ""

const tenant = (org: "a" | "b") => ({
  id: orgs[org],
  host: `lt${org}.localhost`,
})

type Seeded = { issueId: string; version: number }

async function seed(): Promise<Seeded> {
  const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(orgs.a, reporter, { status: "verified", verifiedAt: NOW }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(orgs.a, {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: "Warga melaporkan atap kelas runtuh sejak pekan lalu.",
    },
    actorId: admin,
    campusCode: "LTA",
    now: NOW,
    notify: false,
  })
  if (!merged.ok) throw new Error(merged.reason)
  await runPublish(
    tenant("a"),
    { issueId: merged.issueId, actorId: admin, notify: false },
    { purge: NO_PURGE },
  )
  await suDb.insert(evidence).values({
    orgId: orgs.a,
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
        file: `${"a".repeat(64)}.webp`,
        page: 0,
        width: 10,
        height: 10,
      },
    ],
  })
  const { rows } = await su.query<{ version: number }>(
    "SELECT version FROM issues WHERE id = $1",
    [merged.issueId],
  )
  return { issueId: merged.issueId, version: rows[0]?.version ?? 0 }
}

async function issueRow(id: string) {
  const { rows } = await su.query<{
    published_at: Date | null
    taken_down_at: Date | null
  }>("SELECT published_at, taken_down_at FROM issues WHERE id = $1", [id])
  return rows[0]
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgs.a = await insertOrg(su, "lta")
  orgs.b = await insertOrg(su, "ltb")
  admin = await insertUser(su, "admin.takedown@contoh.id")
})

beforeEach(async () => {
  for (const table of [
    "takedowns",
    "evidence",
    "issue_reports",
    "issues",
    "org_counters",
    "reports",
  ]) {
    await su.query(`DELETE FROM ${table}`)
  }
  await su.query("DELETE FROM pgboss.job WHERE name = 'takedown'")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("legal takedown, PLAN §5.10", () => {
  test("a Komdigi order takes the issue down", async () => {
    const s = await seed()
    const result = await legalTakedown(tenant("a"), {
      issueId: s.issueId,
      version: s.version,
      decision: "remove",
      reason: "komdigi_order",
      actorId: admin,
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
        public_files: [{ file: `${"a".repeat(64)}.webp`, store: "local" }],
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
    const { rows: jobs } = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'takedown'",
    )
    expect(jobs).toHaveLength(1)
  })

  test("a data owner's request hides the issue", async () => {
    const s = await seed()
    expect(
      await legalTakedown(tenant("a"), {
        issueId: s.issueId,
        version: s.version,
        decision: "hide",
        reason: "data_subject_request",
        actorId: admin,
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
      actorId: admin,
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
