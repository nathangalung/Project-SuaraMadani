import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Pool } from "pg"
import { derivedPath, publicMediaPath } from "../../server/files.server.ts"
import { LOW_DATA_REPORTS } from "../../shared/dashboard.ts"
import { REPORT_STATUSES } from "../../shared/status.ts"
import { createDatabase, type Database } from "../client.server.ts"
import { migrate } from "../migrate.ts"
import { resetData, superuserPool, testUrl } from "../testing.ts"
import { seedOrganizations } from "./organizations.ts"
import { seedRegions, TEST_REGIONS } from "./regions.ts"
import { assertDevTarget, main, resetSample, seedSample } from "./sample.ts"
import { SAMPLE_REGIONS } from "./sample-content.ts"
import { SAMPLE_EMAIL_PATTERN } from "./sample-plan.ts"

const su = superuserPool()
let migrator: Database
let basePool: Pool
let filesDir = ""

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  basePool = new Pool({
    connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
  })
  await seedRegions(basePool, TEST_REGIONS)
  await seedOrganizations(basePool, "localhost")
  migrator = createDatabase(testUrl("TEST_DATABASE_MIGRATOR_URL"), "migrate")
  filesDir = await mkdtemp(join(tmpdir(), "sample-seed-"))
})

afterAll(async () => {
  // Other suites count regions
  await su.query("DELETE FROM regions WHERE code = ANY($1)", [
    SAMPLE_REGIONS.map(([code]) => code),
  ])
  await migrator.pool.end()
  await basePool.end()
  await su.end()
  if (filesDir) await rm(filesDir, { recursive: true, force: true })
})

const local = "postgres://u:p@127.0.0.1:55432/sadar_bersuara"

describe("dev target guard", () => {
  test("accepts localhost and 127.0.0.1", () => {
    expect(() =>
      assertDevTarget({
        nodeEnv: "development",
        urls: [local, "postgres://u:p@localhost/x"],
      }),
    ).not.toThrow()
  })

  test("refuses production", () => {
    expect(() =>
      assertDevTarget({ nodeEnv: "production", urls: [local] }),
    ).toThrow("NODE_ENV=production")
  })

  test("Given production or a remote URL, when the CLI runs, then it refuses before connecting", async () => {
    const urls = {
      DATABASE_URL: local,
      DATABASE_MIGRATOR_URL: local,
      DATABASE_MEDIA_URL: local,
    }
    await expect(
      main(["--reset"], { ...urls, NODE_ENV: "production" }),
    ).rejects.toThrow("NODE_ENV=production")
    await expect(
      main([], {
        ...urls,
        DATABASE_MEDIA_URL: "postgres://u:p@db.example.com/x",
      }),
    ).rejects.toThrow("db.example.com")
    const { DATABASE_MEDIA_URL: _, ...partial } = urls
    await expect(main([], partial)).rejects.toThrow("every database URL")
  })

  test("refuses a remote host or a missing URL", () => {
    expect(() =>
      assertDevTarget({
        nodeEnv: "development",
        urls: [local, "postgres://u:p@db.example.com:5432/sadar_bersuara"],
      }),
    ).toThrow("db.example.com")
    expect(() =>
      assertDevTarget({ nodeEnv: "development", urls: [local, undefined] }),
    ).toThrow("every database URL")
  })
})

type Row = Record<string, unknown>

async function sampleRows(): Promise<Row[]> {
  const { rows } = await su.query(
    `SELECT r.id, r.public_code, r.status, r.created_at, r.verified_at,
       i.public_code AS issue, i.gov_status, i.published_at
     FROM reports r JOIN users u ON u.id = r.user_id
     LEFT JOIN issue_reports l ON l.report_id = r.id
     LEFT JOIN issues i ON i.id = l.issue_id
     WHERE u.email LIKE $1 ORDER BY r.id`,
    [SAMPLE_EMAIL_PATTERN],
  )
  return rows
}

async function countBy(sql: string): Promise<Record<string, number>> {
  const { rows } = await su.query<{ k: string; n: number }>(sql)
  return Object.fromEntries(rows.map((row) => [row.k, row.n]))
}

describe("sample seed prerequisites", () => {
  test("Given no campus is seeded, when the sample seed runs, then it names the seeds to run first", async () => {
    await resetData(su)
    try {
      await expect(
        seedSample({ migrator: migrator.db, filesDir }),
      ).rejects.toThrow(
        "Run bun db/seed/regions.ts and bun db/seed/organizations.ts first.",
      )
      const { rows } = await su.query("SELECT 1 FROM reports")
      expect(rows).toEqual([])
    } finally {
      await seedOrganizations(basePool, "localhost")
    }
  })
})

describe("sample seed", () => {
  test("seeds through real paths, re-runs as a no-op, resets", async () => {
    const jobs = () =>
      su
        .query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pgboss.job WHERE name IN ('email-send', 'issue-notify')",
        )
        .then((r) => r.rows[0]?.n)
    const jobsBefore = await jobs()
    const first = await seedSample({ migrator: migrator.db, filesDir })
    expect(first.itb?.state).toBe("empty")
    expect(first.ugm?.state).toBe("empty")
    expect(first.itb?.demands).toBe("empty")

    // Claim step removed 25 Oct
    const claims = await su.query(
      `SELECT 1 FROM resolution_claims UNION ALL
       SELECT 1 FROM issues WHERE gov_status = 'claimed_resolved'`,
    )
    expect(claims.rows).toHaveLength(0)
    const surveys = await su.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'survey-send'",
    )
    expect(surveys.rows).toHaveLength(0)

    // Admin-authored tuntutan, wf8 item 6
    const demands = await su.query<{
      slug: string
      scope: string
      state: string
      items: number
      briefs: number
      updates: number
      sample: boolean
    }>(
      `SELECT o.slug, d.scope, d.state,
         (SELECT count(*)::int FROM demand_items i WHERE i.demand_id = d.id) AS items,
         (SELECT count(*)::int FROM policy_briefs b JOIN demand_items i ON i.id = b.item_id
           WHERE i.demand_id = d.id AND b.published_at IS NOT NULL AND b.status = 'clean') AS briefs,
         (SELECT count(*)::int FROM demand_updates u WHERE u.demand_id = d.id
           AND u.action IN ('status', 'note')) AS updates,
         d.body LIKE '[Data sampel]%' AS sample
       FROM demands d JOIN organizations o ON o.id = d.org_id`,
    )
    for (const slug of ["itb", "ugm"]) {
      const own = demands.rows.filter((row) => row.slug === slug)
      expect(own.length).toBeGreaterThanOrEqual(4)
      expect(new Set(own.map((row) => row.scope))).toEqual(
        new Set(["national", "regional"]),
      )
      expect(own.every((row) => row.sample)).toBe(true)
      expect(own.reduce((n, row) => n + row.briefs, 0)).toBeGreaterThan(0)
    }
    // Drafts too, scope item 6
    expect(
      demands.rows.filter((row) => row.items < 3 || row.items > 6),
    ).toEqual([])
    expect(new Set(demands.rows.map((row) => row.state))).toEqual(
      new Set(["draft", "published", "closed"]),
    )
    const progress = await su.query<{ progress: string }>(
      "SELECT DISTINCT progress FROM demands WHERE state <> 'draft'",
    )
    expect(progress.rows.length).toBeGreaterThanOrEqual(3)

    // Full lists, 25 Oct ranking
    const lists = await su.query<{ slug: string; places: number[] }>(
      `SELECT o.slug, array_agg(r.position ORDER BY r.position) AS places
       FROM demand_rankings r JOIN organizations o ON o.id = r.org_id
       GROUP BY o.slug, r.user_id`,
    )
    for (const slug of ["itb", "ugm"]) {
      const published = demands.rows.filter(
        (row) => row.slug === slug && row.state === "published",
      ).length
      const own = lists.rows.filter((row) => row.slug === slug)
      expect(own.length).toBeGreaterThanOrEqual(10)
      for (const row of own) {
        expect(row.places).toEqual(
          Array.from({ length: published }, (_, i) => i + 1),
        )
      }
    }

    // Every account has a number
    const phones = await su.query<{ missing: number; names: number }>(
      `SELECT count(*) FILTER (WHERE phone_number IS NULL)::int AS missing,
         count(*) FILTER (WHERE name = '')::int AS names
       FROM users WHERE email LIKE $1`,
      [SAMPLE_EMAIL_PATTERN],
    )
    expect(phones.rows[0]).toEqual({ missing: 0, names: 0 })

    const totals = await countBy(
      `SELECT o.slug AS k, count(*)::int AS n FROM reports r
       JOIN organizations o ON o.id = r.org_id GROUP BY 1`,
    )
    expect(totals.itb).toBeGreaterThan(LOW_DATA_REPORTS)
    expect(totals.ugm).toBeLessThan(LOW_DATA_REPORTS)

    for (const slug of ["itb", "ugm"]) {
      const statuses = await countBy(
        `SELECT r.status AS k, count(*)::int AS n FROM reports r
         JOIN organizations o ON o.id = r.org_id
         WHERE o.slug = '${slug}' GROUP BY 1`,
      )
      // Legacy statuses, 25 Oct
      const live = REPORT_STATUSES.filter(
        (s) => !["forwarded", "in_review", "verified"].includes(s),
      )
      expect(Object.keys(statuses).sort()).toEqual([...live].sort())
    }

    // Counts and label match links
    const drift = await su.query(
      `SELECT i.id FROM issues i
       LEFT JOIN issue_reports l ON l.issue_id = i.id
       LEFT JOIN reports r ON r.id = l.report_id
       GROUP BY i.id
       HAVING i.report_count <> count(r.id)
         OR i.verified_report_count <> count(r.verified_at)
         OR (i.verification_label = 'verified') <> (count(r.verified_at) > 0)
         OR bool_or(r.status <> 'merged')`,
    )
    expect(drift.rowCount).toBe(0)

    const history = await su.query(
      `SELECT 1 FROM issues i WHERE i.published_at < i.created_at
         OR i.last_activity_at < coalesce(i.published_at, i.created_at)
         OR i.last_activity_at > now()
       UNION ALL
       SELECT 1 FROM reports r WHERE r.verified_at < r.created_at
         OR r.created_at > now() - interval '1 hour'`,
    )
    expect(history.rowCount).toBe(0)

    const snapshot = await countBy(
      `SELECT o.slug AS k, (d.data->'reports'->>'total')::int AS n
       FROM dashboard_snapshots d JOIN organizations o ON o.id = d.org_id`,
    )
    expect(snapshot).toEqual(totals)

    const all = await su.query<{
      id: string
      org_id: string
      host: string
      kind: string
      status: string
      decision: string | null
      preview_pages: number
      public_media: { file: string }[] | null
    }>(
      `SELECT e.id, e.org_id, o.host, e.kind, e.status, e.decision,
         e.preview_pages, e.public_media
       FROM evidence e JOIN organizations o ON o.id = e.org_id`,
    )
    // PDF, video, unsent upload
    const kinds = await countBy(
      `SELECT o.slug || ':' || e.kind || ':' || e.status AS k, count(*)::int AS n
       FROM evidence e JOIN organizations o ON o.id = e.org_id
       WHERE e.kind <> 'image' OR e.status = 'awaiting_upload'
       GROUP BY 1`,
    )
    expect(kinds).toEqual({
      "itb:pdf:ready": 1,
      "itb:video:ready": 1,
      "itb:image:awaiting_upload": 1,
      "ugm:pdf:ready": 1,
      "ugm:video:ready": 1,
      "ugm:image:awaiting_upload": 1,
    })
    for (const row of all.rows.filter((r) => r.kind === "pdf")) {
      expect(row.preview_pages).toBe(2)
      expect(row.decision).toBeNull()
    }
    const files = {
      rows: all.rows.filter(
        (r) => r.kind === "image" && r.status !== "awaiting_upload",
      ),
    }
    expect(files.rows.length).toBeGreaterThan(0)
    for (const row of files.rows) {
      expect(["ready", "published"]).toContain(row.status)
      const copy = await stat(derivedPath(filesDir, row.org_id, row.id))
      expect(copy.size).toBeGreaterThan(0)
      // Approved copies, real job
      if (row.status === "published") {
        expect(row.decision).not.toBe("withhold")
        for (const media of row.public_media ?? []) {
          const file = await stat(
            publicMediaPath(filesDir, row.host, media.file),
          )
          expect(file.size).toBeGreaterThan(0)
        }
      }
    }
    const statuses = new Set(files.rows.map((row) => row.status))
    expect(statuses).toEqual(new Set(["ready", "published"]))
    expect(files.rows.some((row) => row.decision === "withhold")).toBe(true)
    const leftover = await su.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'evidence-publish'
         AND data->>'evidenceId' IN (SELECT id::text FROM evidence)`,
    )
    expect(leftover.rowCount).toBe(0)

    // Reporters follow, others too
    const follows = await su.query<{ reporters: number; others: number }>(
      `SELECT count(*) FILTER (WHERE own)::int AS reporters,
         count(*) FILTER (WHERE NOT own)::int AS others
       FROM (SELECT EXISTS (SELECT 1 FROM issue_reports l
         JOIN reports r ON r.id = l.report_id
         WHERE l.issue_id = f.issue_id AND r.user_id = f.user_id) AS own
         FROM follows f) s`,
    )
    expect(follows.rows[0]?.reporters).toBeGreaterThan(0)
    expect(follows.rows[0]?.others).toBeGreaterThan(0)
    const lateFollows = await su.query(
      `SELECT 1 FROM follows f JOIN issues i ON i.id = f.issue_id
       WHERE f.created_at > now() OR f.created_at < i.created_at`,
    )
    expect(lateFollows.rowCount).toBe(0)
    // Followers keep a membership
    const orphanFollows = await su.query(
      `SELECT 1 FROM follows f WHERE NOT EXISTS (SELECT 1 FROM members m
         WHERE m.organization_id = f.org_id AND m.user_id = f.user_id)`,
    )
    expect(orphanFollows.rowCount).toBe(0)
    // Seed never queues email
    const queued = await su.query("SELECT 1 FROM notifications")
    expect(queued.rowCount).toBe(0)
    expect(await jobs()).toBe(jobsBefore)

    const consent = await su.query(
      `SELECT 1 FROM users WHERE email LIKE $1
       AND (age_declared_at IS NULL OR age_consent_version IS NULL)`,
      [SAMPLE_EMAIL_PATTERN],
    )
    expect(consent.rowCount).toBe(0)

    // Moderation records via real paths
    const records = await su.query<Record<string, number>>(
      `SELECT
        (SELECT count(*) FROM issues i WHERE i.published_at IS NOT NULL
          AND i.advocacy_status <> 'monitoring'
          AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.issue_id = i.id))::int AS unreferred,
        (SELECT count(*) FROM issues i WHERE i.gov_status = 'responded'
          AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.issue_id = i.id))::int AS silent,
        (SELECT count(*) FROM issue_events e JOIN issues i ON i.id = e.issue_id
          WHERE e.occurred_at < i.published_at OR e.occurred_at > now())::int AS misdated,
        (SELECT count(*) FROM reports r WHERE r.status IN ('rejected', 'unverifiable')
          AND NOT EXISTS (SELECT 1 FROM moderation_decisions d
            WHERE d.report_id = r.id AND d.reason_text IS NOT NULL))::int AS unexplained,
        (SELECT count(*) FROM reports r
          WHERE r.forwarded_from_report_id IS NOT NULL
            OR r.status = 'forwarded')::int AS forwarded,
        (SELECT count(*) FROM issue_events)::int AS events,
        (SELECT count(*) FROM responses)::int AS responses`,
    )
    expect(records.rows[0]).toMatchObject({
      unreferred: 0,
      silent: 0,
      misdated: 0,
      unexplained: 0,
      forwarded: 0,
    })
    expect(records.rows[0]?.events).toBeGreaterThan(40)
    expect(records.rows[0]?.responses).toBeGreaterThan(5)

    const settled = await su.query<Record<string, number>>(
      `SELECT
        (SELECT count(*) FROM content_complaints)::int AS complaints,
        (SELECT count(*) FROM takedowns)::int AS takedowns`,
    )
    expect(settled.rows[0]).toEqual({ complaints: 0, takedowns: 0 })

    const before = await sampleRows()
    const second = await seedSample({ migrator: migrator.db, filesDir })
    expect(second.itb?.state).toBe("complete")
    expect(second.ugm?.state).toBe("complete")
    expect(second.ugm?.demands).toBe("complete")
    expect(await sampleRows()).toEqual(before)

    // Foreign row means outdated plan
    await su.query(
      "UPDATE reports SET submission_id = gen_random_uuid() WHERE id = $1",
      [before[0]?.id],
    )
    await expect(
      seedSample({ migrator: migrator.db, filesDir }),
    ).rejects.toThrow("incomplete or from an older plan")

    // Context issues share the region
    const stray = await su.query(
      `SELECT d.public_code FROM demand_issues di
       JOIN demands d ON d.id = di.demand_id
       JOIN issues i ON i.id = di.issue_id
       WHERE d.scope = 'regional' AND (i.province_code <> d.province_code
         OR (d.regency_code IS NOT NULL AND i.regency_code <> d.regency_code))`,
    )
    expect(stray.rows).toEqual([])
    const audit = await su.query("SELECT count(*)::int AS n FROM audit_log")
    const removed = await resetSample({ migrator: migrator.db, filesDir })
    expect(removed.reports).toBe(before.length)
    expect(await sampleRows()).toEqual([])
    const left = await su.query(
      `SELECT (SELECT count(*) FROM issues)::int AS issues,
         (SELECT count(*) FROM demands)::int AS demands,
         (SELECT count(*) FROM content_complaints)::int AS complaints,
         (SELECT count(*) FROM takedowns)::int AS takedowns,
         (SELECT count(*) FROM org_counters)::int AS counters,
         (SELECT count(*) FROM users WHERE email LIKE $1)::int AS reporters,
         (SELECT count(*) FROM members WHERE role = 'admin')::int AS staff,
         (SELECT count(*) FROM audit_log)::int AS audit`,
      [SAMPLE_EMAIL_PATTERN],
    )
    expect(left.rows[0]).toEqual({
      issues: 0,
      demands: 0,
      complaints: 0,
      takedowns: 0,
      counters: 0,
      reporters: 0,
      staff: 4,
      audit: audit.rows[0]?.n,
    })
    for (const row of files.rows) {
      const gone = stat(derivedPath(filesDir, row.org_id, row.id))
      await expect(gone).rejects.toThrow("ENOENT")
      for (const media of row.public_media ?? []) {
        const copy = stat(publicMediaPath(filesDir, row.host, media.file))
        await expect(copy).rejects.toThrow("ENOENT")
      }
    }
  }, 180_000)
})
