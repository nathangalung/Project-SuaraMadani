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
import { INITIAL_ISSUE_STATE } from "../../../shared/status.ts"
import { issuePurgeUrls, runPublish } from "../issues/publish.server.ts"
import { runMerge } from "./merge.server.ts"
import { type IssueActionInput, runIssueAction } from "./referrals.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
const NO_PURGE: PurgeClient = {
  purgeUrls: async () => ({ skipped: true }),
  purgeHosts: async () => ({ skipped: true }),
}
let orgA = ""
let orgB = ""
let moderator = ""

const tenantA = () => ({ id: orgA, host: "itb.localhost" })

async function seedIssue(options: { publish: boolean } = { publish: true }) {
  const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(orgA, reporter, { status: "verified", verifiedAt: NOW }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(orgA, {
    reportIds: [report.id],
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: "Beberapa laporan menyebut atap ruang kelas runtuh.",
    },
    actorId: moderator,
    now: NOW,
  })
  if (!merged.ok) throw new Error(merged.reason)
  if (options.publish) {
    await runPublish(
      tenantA(),
      { issueId: merged.issueId, actorId: moderator },
      { purge: NO_PURGE },
    )
  }
  const { rows } = await su.query<{ version: number }>(
    "SELECT version FROM issues WHERE id = $1",
    [merged.issueId],
  )
  return {
    id: merged.issueId,
    code: merged.code,
    version: rows[0]?.version ?? 0,
  }
}

type Issue = Awaited<ReturnType<typeof seedIssue>>

function refer(issue: Issue): IssueActionInput {
  return {
    issueId: issue.id,
    seen: { ...INITIAL_ISSUE_STATE, version: issue.version },
    actorId: moderator,
    action: "refer",
    referral: {
      agency: "Dinas Pendidikan Kota Bandung",
      channel: "agency_service",
      ticket: "TIKET-2026-0042",
      sentOn: "2026-10-12",
      deadlineOn: "2026-10-26",
    },
  }
}

async function issueRow(id: string) {
  const { rows } = await su.query<{
    advocacy_status: string
    gov_status: string
    version: number
  }>("SELECT advocacy_status, gov_status, version FROM issues WHERE id = $1", [
    id,
  ])
  return rows[0]
}

async function count(table: string, issueId: string) {
  const { rows } = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE issue_id = $1`,
    [issueId],
  )
  return rows[0]?.n ?? 0
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  moderator = await insertUser(su, "moderator.refer@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
  await su.query("DELETE FROM pgboss.job WHERE name = 'issue-notify'")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("runIssueAction", () => {
  test("refer stores the referral, event, audit, then purges", async () => {
    const issue = await seedIssue()
    const purged: string[][] = []
    const result = await runIssueAction(tenantA(), refer(issue), {
      purge: {
        ...NO_PURGE,
        purgeUrls: async (urls) => {
          purged.push(urls)
          return { skipped: false }
        },
      },
    })
    expect(result).toEqual({
      ok: true,
      code: issue.code,
      version: issue.version + 1,
    })
    expect(await issueRow(issue.id)).toEqual({
      advocacy_status: "referred",
      gov_status: "awaiting_response",
      version: issue.version + 1,
    })
    const { rows: referral } = await su.query(
      "SELECT kind, agency, channel, ticket, sent_on::text, deadline_on::text, created_by FROM referrals WHERE issue_id = $1",
      [issue.id],
    )
    expect(referral).toEqual([
      {
        kind: "referral",
        agency: "Dinas Pendidikan Kota Bandung",
        channel: "agency_service",
        ticket: "TIKET-2026-0042",
        sent_on: "2026-10-12",
        deadline_on: "2026-10-26",
        created_by: moderator,
      },
    ])
    const { rows: events } = await su.query(
      "SELECT action, advocacy_status, gov_status, referral_id IS NOT NULL AS linked FROM issue_events WHERE issue_id = $1",
      [issue.id],
    )
    expect(events).toEqual([
      {
        action: "refer",
        advocacy_status: "referred",
        gov_status: "awaiting_response",
        linked: true,
      },
    ])
    const { rows: audit } = await su.query(
      "SELECT action, reason_code FROM audit_log WHERE entity_id = $1 AND action = 'issue.refer'",
      [issue.id],
    )
    expect(audit).toEqual([
      { action: "issue.refer", reason_code: "agency_service" },
    ])
    const { rows: jobs } = await su.query(
      "SELECT data->>'template' AS template FROM pgboss.job WHERE name = 'issue-notify' AND data->>'issueId' = $1",
      [issue.id],
    )
    // No follower emails, 25 Oct
    expect(jobs).toEqual([])
    expect(purged).toEqual([
      issuePurgeUrls("itb.localhost", {
        code: issue.code,
        version: issue.version + 1,
      }),
    ])
  })

  test("record response keeps the full text and source", async () => {
    const issue = await seedIssue()
    await runIssueAction(tenantA(), refer(issue), { purge: NO_PURGE })
    const result = await runIssueAction(
      tenantA(),
      {
        issueId: issue.id,
        seen: {
          advocacy: "referred",
          government: "awaiting_response",
          version: issue.version + 1,
        },
        actorId: moderator,
        action: "record_response",
        response: {
          agency: "Dinas Pendidikan Kota Bandung",
          body: "Perbaikan atap dijadwalkan pada November.\n\nAnggaran sudah disetujui.",
          respondedOn: "2026-10-20",
          sourceUrl: "https://contoh.go.id/siaran/42",
        },
      },
      { purge: NO_PURGE },
    )
    expect(result.ok).toBe(true)
    expect((await issueRow(issue.id))?.gov_status).toBe("responded")
    const { rows } = await su.query(
      "SELECT body, responded_on::text, source_url FROM responses WHERE issue_id = $1",
      [issue.id],
    )
    expect(rows).toEqual([
      {
        body: "Perbaikan atap dijadwalkan pada November.\n\nAnggaran sudah disetujui.",
        responded_on: "2026-10-20",
        source_url: "https://contoh.go.id/siaran/42",
      },
    ])
    const { rows: events } = await su.query(
      "SELECT action FROM issue_events WHERE issue_id = $1 AND response_id IS NOT NULL",
      [issue.id],
    )
    expect(events).toEqual([{ action: "record_response" }])
  })

  test("close keeps its public reason", async () => {
    const issue = await seedIssue()
    const result = await runIssueAction(
      tenantA(),
      {
        issueId: issue.id,
        seen: { ...INITIAL_ISSUE_STATE, version: issue.version },
        actorId: moderator,
        action: "close",
        note: "Laporan baru menunjukkan sekolah sudah pindah gedung.",
      },
      { purge: NO_PURGE },
    )
    expect(result.ok).toBe(true)
    const { rows } = await su.query(
      "SELECT action, gov_status, note FROM issue_events WHERE issue_id = $1",
      [issue.id],
    )
    expect(rows).toEqual([
      {
        action: "close",
        gov_status: "closed",
        note: "Laporan baru menunjukkan sekolah sudah pindah gedung.",
      },
    ])
  })

  test("a transition the machine forbids writes nothing", async () => {
    const issue = await seedIssue()
    const result = await runIssueAction(
      tenantA(),
      {
        issueId: issue.id,
        seen: { ...INITIAL_ISSUE_STATE, version: issue.version },
        actorId: moderator,
        action: "reopen",
        note: "Warga melapor masalahnya muncul lagi.",
      },
      { purge: NO_PURGE },
    )
    // Reopen needs a legacy claim
    expect(result).toEqual({ ok: false, reason: "not_allowed" })
    expect(await count("issue_events", issue.id)).toBe(0)
  })

  test("a draft issue cannot be referred", async () => {
    const issue = await seedIssue({ publish: false })
    const result = await runIssueAction(tenantA(), refer(issue), {
      purge: NO_PURGE,
    })
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect(await count("referrals", issue.id)).toBe(0)
  })

  test("concurrent referrals from one view: only one wins", async () => {
    const issue = await seedIssue()
    const results = await Promise.all([
      runIssueAction(tenantA(), refer(issue), { purge: NO_PURGE }),
      runIssueAction(tenantA(), refer(issue), { purge: NO_PURGE }),
      runIssueAction(tenantA(), refer(issue), { purge: NO_PURGE }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "changed" },
      { ok: false, reason: "changed" },
    ])
    expect(await count("referrals", issue.id)).toBe(1)
    expect(await count("issue_events", issue.id)).toBe(1)
    expect((await issueRow(issue.id))?.version).toBe(issue.version + 1)
  })

  test("another campus cannot act on the issue", async () => {
    const issue = await seedIssue()
    const result = await runIssueAction(
      { id: orgB, host: "ugm.localhost" },
      refer(issue),
      { purge: NO_PURGE },
    )
    expect(result).toEqual({ ok: false, reason: "changed" })
    expect(await issueRow(issue.id)).toMatchObject({
      advocacy_status: "monitoring",
      version: issue.version,
    })
    expect(await count("referrals", issue.id)).toBe(0)
  })

  test("a merge into a published issue adds a timeline event", async () => {
    const issue = await seedIssue()
    const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
    const [report] = await suDb
      .insert(reports)
      .values(reportValues(orgA, reporter, { status: "verified" }))
      .returning({ id: reports.id })
    if (!report) throw new Error("no report")
    await runMerge(orgA, {
      reportIds: [report.id],
      target: { kind: "existing", issueId: issue.id },
      actorId: moderator,
      now: NOW,
    })
    const { rows } = await su.query(
      "SELECT action, gov_status FROM issue_events WHERE issue_id = $1",
      [issue.id],
    )
    expect(rows).toEqual([{ action: "merge", gov_status: "awaiting_response" }])
  })
})
