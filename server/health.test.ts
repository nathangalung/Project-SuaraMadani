import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { schema } from "../db/client.server.ts"
import { QUEUES } from "../db/jobs.server.ts"
import { migrate } from "../db/migrate.ts"
import { insertOrg, resetData, superuserPool, testUrl } from "../db/testing.ts"
import { EMAIL_QUOTA } from "../shared/notifications.ts"
import { archiveFailing, poolHealth } from "./health.ts"

const su = superuserPool()
// Runs as sm_app, real RLS
const appPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sm_app",
})
const appDb = drizzle({ client: appPool, schema })

let orgA = ""
let orgB = ""

async function snapshot(orgId: string, ageSeconds: number): Promise<void> {
  await su.query(
    `INSERT INTO dashboard_snapshots (org_id, data, computed_at)
     VALUES ($1, '{}', now() - make_interval(secs => $2))
     ON CONFLICT (org_id) DO UPDATE SET computed_at = excluded.computed_at`,
    [orgId, ageSeconds],
  )
}

function jobs(backups = false) {
  return poolHealth(appPool, appDb, { backups }).jobs()
}

async function backupRun(kind: string, ageSeconds: number): Promise<void> {
  await su.query(
    `INSERT INTO backup_runs (kind, finished_at)
     VALUES ($1, now() - make_interval(secs => $2))`,
    [kind, ageSeconds],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  orgA = await insertOrg(su, "hlta")
  orgB = await insertOrg(su, "hltb")
})

beforeEach(async () => {
  // Isolate from queue checks
  await su.query("DELETE FROM pgboss.job WHERE name = ANY($1)", [
    QUEUES.map((queue) => queue.name),
  ])
  await su.query("DELETE FROM takedowns")
  await su.query("DELETE FROM backup_runs")
  await su.query("DELETE FROM email_log")
  await su.query("DELETE FROM whatsapp_sender")
  await snapshot(orgA, 60)
  await snapshot(orgB, 60)
  await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
})

afterAll(async () => {
  await resetData(su)
  await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
  await su.end()
  await appPool.end()
})

describe("WhatsApp sender", () => {
  async function sender(status: string, seenSeconds: number) {
    await su.query(
      `INSERT INTO whatsapp_sender (id, provider, status, last_seen_at)
       VALUES (1, 'baileys', $1, now() - make_interval(secs => $2))`,
      [status, seenSeconds],
    )
  }

  test("not deployed or deliberately unlinked passes", async () => {
    expect((await jobs()).checks).toMatchObject({
      whatsapp_ready: 0,
      whatsapp_down: 0,
    })
    await sender("unlinked", 5)
    const report = await jobs()
    expect(report.checks.whatsapp_down).toBe(0)
    expect(report.ok).toBe(true)
  })

  test("a graceful stop, the incident lever, passes", async () => {
    await sender("stopped", 600)
    const report = await jobs()
    expect(report.checks).toMatchObject({ whatsapp_ready: 0, whatsapp_down: 0 })
    expect(report.ok).toBe(true)
  })

  test("connected with a fresh heartbeat passes", async () => {
    await sender("connected", 5)
    const report = await jobs()
    expect(report.checks).toMatchObject({ whatsapp_ready: 1, whatsapp_down: 0 })
    expect(report.ok).toBe(true)
  })

  test("logged out, dropped or silent fails", async () => {
    for (const [status, seen] of [
      ["logged_out", 5],
      ["disconnected", 5],
      ["connected", 600],
    ] as const) {
      await su.query("DELETE FROM whatsapp_sender")
      await sender(status, seen)
      const report = await jobs()
      expect([status, report.checks.whatsapp_down]).toEqual([status, 1])
      expect(report.ok).toBe(false)
    }
  })
})

describe("snapshot age", () => {
  test("fresh snapshots in every org pass", async () => {
    const report = await jobs()
    expect(report.checks.dashboard_snapshot_stale).toBe(0)
    expect(report.ok).toBe(true)
  })

  test("a missing snapshot in the second org fails", async () => {
    await su.query("DELETE FROM dashboard_snapshots WHERE org_id = $1", [orgB])
    const report = await jobs()
    expect(report.checks.dashboard_snapshot_stale).toBe(1)
    expect(report.ok).toBe(false)
  })

  test("a snapshot older than 1 h fails", async () => {
    await snapshot(orgA, 3601 + 60)
    const report = await jobs()
    expect(report.checks.dashboard_snapshot_stale).toBe(1)
    expect(report.ok).toBe(false)
  })
})

describe("takedowns", () => {
  async function takedown(orgId: string, ageSeconds: number, done = false) {
    await su.query(
      `INSERT INTO takedowns (org_id, action, purge_status, created_at, done_at)
       VALUES ($1, 'take_down', $3, now() - make_interval(secs => $2), $4)`,
      [orgId, ageSeconds, done ? "done" : "pending", done ? new Date() : null],
    )
  }

  test("a fresh pending takedown passes", async () => {
    await takedown(orgB, 60)
    const report = await jobs()
    expect(report.checks.takedown_late).toBe(0)
    expect(report.ok).toBe(true)
  })

  test("not done after 10 minutes in the second org fails", async () => {
    await takedown(orgA, 3600, true)
    await takedown(orgB, 601)
    const report = await jobs()
    expect(report.checks.takedown_late).toBe(1)
    expect(report.ok).toBe(false)
  })

  test("a dead takedown job fails", async () => {
    await su.query(
      "INSERT INTO pgboss.job (name, data, state) VALUES ('takedown-dlq', '{}', 'created')",
    )
    const report = await jobs()
    expect(report.checks["takedown-dlq"]).toBe(1)
    expect(report.ok).toBe(false)
  })
})

describe("national view age", () => {
  test("a fresh refresh passes", async () => {
    const report = await jobs()
    expect(report.checks.national_stale).toBe(0)
    expect(report.ok).toBe(true)
  })

  test("a view never refreshed fails", async () => {
    await su.query(
      "REFRESH MATERIALIZED VIEW public.national_aggregates WITH NO DATA",
    )
    const report = await jobs()
    expect(report.checks.national_stale).toBe(1)
    expect(report.ok).toBe(false)
  })
})

describe("queues", () => {
  test("every dead letter queue is checked", async () => {
    const report = await jobs()
    const dead = QUEUES.flatMap((queue) =>
      queue.deadLetter ? [queue.deadLetter] : [],
    )
    expect(dead).toContain("email-send-dlq")
    for (const name of dead) expect(report.checks[name]).toBe(0)
  })

  test("a dead email job fails", async () => {
    await su.query(
      "INSERT INTO pgboss.job (name, data, state) VALUES ('email-send-dlq', '{}', 'created')",
    )
    const report = await jobs()
    expect(report.checks["email-send-dlq"]).toBe(1)
    expect(report.ok).toBe(false)
  })

  test("an email job ready for over 600 s fails", async () => {
    await su.query(
      `INSERT INTO pgboss.job (name, data, state, created_on, start_after)
       VALUES ('email-send', '{}', 'created', now() - interval '601 seconds', now() - interval '601 seconds')`,
    )
    const report = await jobs()
    expect(report.checks["email-send_oldest_ready_s"]).toBeGreaterThan(600)
    expect(report.ok).toBe(false)
  })

  test("a deferred email job is not late", async () => {
    await su.query(
      `INSERT INTO pgboss.job (name, data, state, created_on, start_after)
       VALUES ('email-send', '{}', 'created', now() - interval '2 days', now() + interval '1 hour')`,
    )
    const report = await jobs()
    expect(report.checks["email-send_oldest_ready_s"]).toBe(0)
    expect(report.ok).toBe(true)
  })

  test("a deferred email job just woken is not late", async () => {
    // Ceiling deferral to 07:00 WIB
    await su.query(
      `INSERT INTO pgboss.job (name, data, state, created_on, start_after)
       VALUES ('email-send', '{}', 'created', now() - interval '11 hours', now() - interval '30 seconds')`,
    )
    const report = await jobs()
    expect(report.checks["email-send_oldest_ready_s"]).toBeLessThan(60)
    expect(report.ok).toBe(true)
  })

  test("a failed maintenance run fails", async () => {
    await su.query(
      "INSERT INTO pgboss.job (name, data, state) VALUES ('maintenance-daily', '{}', 'failed')",
    )
    const report = await jobs()
    expect(report.checks.maintenance_failed).toBe(1)
    expect(report.ok).toBe(false)
  })

  test("a maintenance run waiting 6 h fails", async () => {
    await su.query(
      `INSERT INTO pgboss.job (name, data, state, created_on, start_after)
       VALUES ('maintenance-daily', '{}', 'created', now() - interval '7 hours', now() - interval '7 hours')`,
    )
    const report = await jobs()
    expect(report.checks["maintenance-daily_oldest_ready_s"]).toBeGreaterThan(
      6 * 3600,
    )
    expect(report.ok).toBe(false)
  })

  test("evidence-publish waits up to 1800 s", async () => {
    await su.query(
      `INSERT INTO pgboss.job (name, data, state, created_on, start_after)
       VALUES ('evidence-publish', '{}', 'created', now() - interval '1801 seconds', now() - interval '1801 seconds')`,
    )
    const report = await jobs()
    expect(report.checks["evidence-publish_oldest_ready_s"]).toBeGreaterThan(
      1800,
    )
    expect(report.ok).toBe(false)
  })
})

async function emails(n: number, status: string, ageSeconds = 0) {
  await su.query(
    `INSERT INTO email_log (kind, address_hash, status, created_at)
     SELECT 'otp', md5(g::text), $2, now() - make_interval(secs => $3)
     FROM generate_series(1, $1) g`,
    [n, status, ageSeconds],
  )
}

describe("email quota", () => {
  test("under 70% of the daily quota passes", async () => {
    await emails(209, "sent")
    const report = await jobs()
    expect(report.checks.email_quota_used).toBe(209)
    expect(report.ok).toBe(true)
  })

  test("70% of the daily quota fails", async () => {
    await emails(200, "sent")
    await emails(10, "reserved")
    const report = await jobs()
    expect(report.checks.email_quota_used).toBe(210)
    expect(report.ok).toBe(false)
  })

  test("a full Daftar share fails", async () => {
    await su.query(
      `INSERT INTO email_log (kind, address_hash, status, purpose)
       SELECT 'otp', md5(g::text), 'sent', 'sign_up'
       FROM generate_series(1, $1) g`,
      [EMAIL_QUOTA.signUpPerDay - 1],
    )
    expect((await jobs()).checks.email_signup_used).toBe(
      EMAIL_QUOTA.signUpPerDay - 1,
    )
    expect((await jobs()).ok).toBe(true)
    await emails(1, "sent")
    await su.query(
      "UPDATE email_log SET purpose = 'sign_up' WHERE purpose IS NULL",
    )
    const report = await jobs()
    expect(report.checks.email_signup_used).toBe(EMAIL_QUOTA.signUpPerDay)
    expect(report.ok).toBe(false)
  })

  test("failed and earlier sends do not count", async () => {
    await emails(150, "failed")
    await emails(150, "sent", 2 * 86_400)
    const report = await jobs()
    expect(report.checks.email_quota_used).toBe(0)
    expect(report.ok).toBe(true)
  })
})

describe("backups", () => {
  test("off by default, no backup checks", async () => {
    const report = await jobs()
    expect(report.checks.backup_pgbackrest_age_s).toBeUndefined()
    expect(report.ok).toBe(true)
  })

  test("required with no runs fails", async () => {
    const report = await jobs(true)
    expect(report.checks.backup_pgbackrest_age_s).toBe(-1)
    expect(report.checks.backup_restic_age_s).toBe(-1)
    expect(report.checks["backup_b2-copy_age_s"]).toBe(-1)
    expect(report.ok).toBe(false)
  })

  test("fresh runs of every kind pass the run check", async () => {
    await backupRun("pgbackrest", 3600)
    await backupRun("restic", 3600)
    await backupRun("b2-copy", 86_400)
    const report = await jobs(true)
    expect(report.checks.backup_stale).toBe(0)
  })

  test("a database backup older than 26 h fails", async () => {
    await backupRun("pgbackrest", 26 * 3600 + 60)
    await backupRun("restic", 60)
    await backupRun("b2-copy", 60)
    const report = await jobs(true)
    expect(report.checks.backup_stale).toBe(1)
    expect(report.ok).toBe(false)
  })

  test("the newest run per kind counts", async () => {
    await backupRun("restic", 9 * 3600)
    await backupRun("restic", 60)
    await backupRun("pgbackrest", 60)
    await backupRun("b2-copy", 7 * 86_400)
    const report = await jobs(true)
    expect(report.checks.backup_stale).toBe(0)
  })

  test("the test database never archived WAL, which fails", async () => {
    const report = await jobs(true)
    expect(report.checks.wal_archive_failing).toBe(1)
    expect(report.ok).toBe(false)
  })
})

describe("archiveFailing", () => {
  const now = Date.parse("2026-10-15T00:00:00Z")
  const ago = (s: number) => new Date(now - s * 1000)

  test("a recent archive passes", () => {
    expect(
      archiveFailing({ lastArchived: ago(60), lastFailed: null }, now),
    ).toBe(false)
  })

  test("no archive yet fails", () => {
    expect(archiveFailing({ lastArchived: null, lastFailed: null }, now)).toBe(
      true,
    )
  })

  test("an archive older than 15 minutes fails", () => {
    expect(
      archiveFailing({ lastArchived: ago(901), lastFailed: null }, now),
    ).toBe(true)
  })

  test("a failure after the last success fails", () => {
    expect(
      archiveFailing({ lastArchived: ago(120), lastFailed: ago(30) }, now),
    ).toBe(true)
  })

  test("an old failure, then success, passes", () => {
    expect(
      archiveFailing({ lastArchived: ago(30), lastFailed: ago(120) }, now),
    ).toBe(false)
  })
})
