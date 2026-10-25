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
import { runMerge } from "../moderation/merge.server.ts"
import {
  issuePurgeUrls,
  purgeIssuePages,
  runPublish,
} from "./publish.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
let orgA = ""
let orgB = ""
let moderator = ""

async function seedIssue(org = orgA) {
  const reporter = await insertUser(su, `p${crypto.randomUUID()}@contoh.id`)
  const [report] = await suDb
    .insert(reports)
    .values(
      reportValues(org, reporter, { status: "verified", verifiedAt: NOW }),
    )
    .returning({ id: reports.id })
  if (!report) throw new Error("no report")
  const merged = await runMerge(org, {
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
  return merged
}

type Seen = { urls: string[]; publishedWhenCalled: boolean }

function recordingPurge(seen: Seen[], issueId: string): PurgeClient {
  return {
    async purgeUrls(urls) {
      const { rows } = await su.query<{ published: boolean }>(
        "SELECT published_at IS NOT NULL AS published FROM issues WHERE id = $1",
        [issueId],
      )
      seen.push({ urls, publishedWhenCalled: rows[0]?.published === true })
      return { skipped: false }
    },
    purgeHosts: async () => ({ skipped: false }),
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  moderator = await insertUser(su, "moderator.publish@contoh.id")
})

beforeEach(async () => {
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("issuePurgeUrls", () => {
  test("lists the issue, every OG version, lists and their data URLs", () => {
    expect(
      issuePurgeUrls("itb.suaramadani.id", {
        code: "ISU-2026-10-0001",
        version: 3,
      }),
    ).toEqual([
      "https://itb.suaramadani.id/isu/ISU-2026-10-0001",
      "https://itb.suaramadani.id/isu/ISU-2026-10-0001.data",
      "https://itb.suaramadani.id/isu",
      "https://itb.suaramadani.id/isu.data",
      "https://itb.suaramadani.id/",
      "https://itb.suaramadani.id/_root.data",
      "https://itb.suaramadani.id/data",
      "https://itb.suaramadani.id/data.data",
      "https://itb.suaramadani.id/isu/ISU-2026-10-0001/og.png?v=1",
      "https://itb.suaramadani.id/isu/ISU-2026-10-0001/og.png?v=2",
      "https://itb.suaramadani.id/isu/ISU-2026-10-0001/og.png?v=3",
      "https://itb.suaramadani.id/api/v1/isu/ISU-2026-10-0001",
      "https://itb.suaramadani.id/api/v1/isu",
      "https://itb.suaramadani.id/api/v1/data",
      "https://itb.suaramadani.id/api/v1/data/peringkat-isu.csv",
    ])
  })
})

describe("runPublish", () => {
  test("publishes, bumps the version, audits, then purges after commit", async () => {
    const issue = await seedIssue()
    const seen: Seen[] = []
    const result = await runPublish(
      { id: orgA, host: "itb.localhost" },
      { issueId: issue.issueId, actorId: moderator },
      { purge: recordingPurge(seen, issue.issueId) },
    )
    expect(result).toEqual({ ok: true, code: issue.code, version: 2 })
    const { rows } = await su.query<{ version: number; published: boolean }>(
      "SELECT version, published_at IS NOT NULL AS published FROM issues WHERE id = $1",
      [issue.issueId],
    )
    expect(rows[0]).toEqual({ version: 2, published: true })
    expect(seen).toEqual([
      {
        urls: issuePurgeUrls("itb.localhost", { code: issue.code, version: 2 }),
        publishedWhenCalled: true,
      },
    ])
    const audit = await su.query(
      "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'issue.publish'",
      [issue.issueId],
    )
    expect(audit.rows).toHaveLength(1)
  })

  test("publication fans out to followers through one job", async () => {
    const issue = await seedIssue()
    await runPublish(
      { id: orgA, host: "itb.localhost" },
      { issueId: issue.issueId, actorId: moderator },
      { purge: recordingPurge([], issue.issueId) },
    )
    const { rows } = await su.query<{ template: string; audited: boolean }>(
      `SELECT j.data->>'template' AS template,
         EXISTS (SELECT 1 FROM audit_log a
           WHERE a.id::text = j.data->>'eventId' AND a.action = 'issue.publish') AS audited
       FROM pgboss.job j
       WHERE j.name = 'issue-notify' AND j.data->>'issueId' = $1`,
      [issue.issueId],
    )
    expect(rows).toEqual([{ template: "issue_published", audited: true }])
  })

  test("a second publish changes nothing", async () => {
    const issue = await seedIssue()
    const tenant = { id: orgA, host: "itb.localhost" }
    const seen: Seen[] = []
    const deps = { purge: recordingPurge(seen, issue.issueId) }
    const input = { issueId: issue.issueId, actorId: moderator }
    const results = await Promise.all([
      runPublish(tenant, input, deps),
      runPublish(tenant, input, deps),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "changed" })
    expect(seen).toHaveLength(1)
  })

  test("another tenant cannot publish the issue", async () => {
    const issue = await seedIssue()
    const result = await runPublish(
      { id: orgB, host: "ugm.localhost" },
      { issueId: issue.issueId, actorId: moderator },
      { purge: recordingPurge([], issue.issueId) },
    )
    expect(result).toEqual({ ok: false, reason: "changed" })
  })
})

describe("purgeIssuePages", () => {
  test("a failing purge logs one line and does not throw", async () => {
    const lines: Record<string, unknown>[] = []
    await purgeIssuePages(
      "itb.localhost",
      { code: "ISU-2026-10-0001", version: 1 },
      {
        purge: {
          purgeUrls: async () => {
            throw new Error("purge failed: 429")
          },
          purgeHosts: async () => ({ skipped: false }),
        },
        log: (line) => lines.push(line),
      },
    )
    expect(lines).toEqual([
      expect.objectContaining({
        msg: "purge failed",
        host: "itb.localhost",
        issue: "ISU-2026-10-0001",
        error: "Error",
        message: "purge failed: 429",
      }),
    ])
  })
})
