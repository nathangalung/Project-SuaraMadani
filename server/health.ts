import { sql } from "drizzle-orm"
import type { Pool } from "pg"
import type { Db } from "../db/client.server.ts"
import { QUEUES } from "../db/jobs.server.ts"
import { BACKUP_KINDS, type BackupKind } from "../db/schema/backups.ts"
import { pgError, withTenant } from "../db/tenant.server.ts"
import { EMAIL_QUOTA, jakartaDayStart } from "../shared/notifications.ts"
import { type WhatsAppStatus, whatsappReady } from "../shared/whatsapp.ts"
import { withDeadline } from "./http.ts"

type JobsHealth = { ok: boolean; checks: Record<string, number> }

export type HealthChecks = {
  db(): Promise<void>
  jobs(): Promise<JobsHealth>
}

// Starting Values: oldest ready
const OLDEST_READY_LIMIT: Record<string, number> = {
  "email-send": 600,
  takedown: 600,
  evidence: 1800,
  "evidence-publish": 1800,
  // Admin waits on the scan
  "evidence-brief": 1800,
  // Daily retention, missed run
  "maintenance-daily": 6 * 3600,
  // Daily admin digest
  "deadline-reminders": 6 * 3600,
  // Codes live 5 minutes
  "whatsapp-send": 120,
}
const DEAD_LETTER_QUEUES = QUEUES.flatMap((queue) =>
  queue.deadLetter ? [queue.deadLetter] : [],
)
// Starting Values: newest run
const BACKUP_LIMIT_S: Record<BackupKind, number> = {
  pgbackrest: 26 * 3600,
  // Same daily timer
  "pgbackrest-verify": 26 * 3600,
  restic: 8 * 3600,
  "b2-copy": 8 * 86_400,
  // Hourly timer, two misses
  logs: 3 * 3600,
}
const ARCHIVE_LIMIT_MS = 15 * 60_000
// PLAN §5.10: ten minutes
const TAKEDOWN_LIMIT_S = 600
const CACHE_MS = 30_000
// decisions.md Health checks row
const DB_DEADLINE_MS = 1000
// ADR-07: snapshot 1 h
const SNAPSHOT_LIMIT_S = 3600
// Starting Values: page at 70%
const EMAIL_ALERT_USED = Math.ceil(EMAIL_QUOTA.providerDaily * 0.7)

// Ready since start_after, not creation
const OLDEST_READY_SQL = `
  SELECT coalesce(extract(epoch FROM now() - min(greatest(created_on, start_after))), 0)::int AS age
  FROM pgboss.job
  WHERE name = $1 AND state = 'created' AND start_after <= now()`

// No DLQ: failed rows stay
const CRON_FAILED_SQL = `
  SELECT count(*)::int AS n FROM pgboss.job
  WHERE name = $1 AND state = 'failed'
    AND created_on > now() - interval '2 days'`
// Daily crons without a DLQ
const CRON_FAILED: Record<string, string> = {
  "maintenance-daily": "maintenance_failed",
  "deadline-reminders": "deadline_reminders_failed",
}

const DEAD_SQL = `
  SELECT count(*)::int AS n FROM pgboss.job
  WHERE name = $1 AND state IN ('created', 'retry', 'active')`

/** Per org, missing counts stale. */
async function tenantChecks(
  pool: Pool,
  db: Db,
): Promise<{ stale: number; lateTakedowns: number }> {
  const { rows: orgs } = await pool.query<{ id: string }>(
    "SELECT id FROM organizations",
  )
  let stale = 0
  let lateTakedowns = 0
  for (const org of orgs) {
    const found = await withTenant(
      org.id,
      async (tx) => {
        const { rows } = await tx.execute<{ age: number | null; late: number }>(
          sql`SELECT
            (SELECT extract(epoch FROM now() - computed_at)::int FROM dashboard_snapshots) AS age,
            (SELECT count(*)::int FROM takedowns
              WHERE purge_status <> 'done'
                AND created_at < now() - make_interval(secs => ${TAKEDOWN_LIMIT_S})) AS late`,
        )
        return rows[0]
      },
      { db },
    )
    const age = found?.age ?? null
    if (age === null || age > SNAPSHOT_LIMIT_S) stale++
    lateTakedowns += found?.late ?? 0
  }
  return { stale, lateTakedowns }
}

/** Unpopulated counts as stale. */
async function nationalStale(pool: Pool): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ age: number | null }>(
      "SELECT extract(epoch FROM now() - max(computed_at))::int AS age FROM public.national_aggregates",
    )
    const age = rows[0]?.age ?? null
    return age === null || age > SNAPSHOT_LIMIT_S
  } catch (error) {
    // 55000: never refreshed
    if (pgError(error)?.code === "55000") return true
    throw error
  }
}

/** Provider sends since 00:00 WIB. */
async function emailsToday(pool: Pool, now: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM email_log
     WHERE status IN ('reserved', 'sent') AND created_at >= $1`,
    [jakartaDayStart(new Date(now))],
  )
  return rows[0]?.n ?? 0
}

/** Daftar codes, rolling 24 h. */
async function emailSignUps(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM email_log
     WHERE kind = 'otp' AND purpose = 'sign_up'
       AND status IN ('reserved', 'sent')
       AND created_at >= now() - interval '1 day'`,
  )
  return rows[0]?.n ?? 0
}

// Unlinking, or a graceful stop
const DELIBERATE: readonly WhatsAppStatus[] = ["unlinked", "linking", "stopped"]

/** Ready, or down unless deliberate. */
async function whatsappChecks(
  pool: Pool,
  now: number,
): Promise<{ ready: number; down: number }> {
  const { rows } = await pool.query<{
    status: WhatsAppStatus
    last_seen_at: Date | null
  }>("SELECT status, last_seen_at FROM whatsapp_sender WHERE id = 1")
  const row = rows[0]
  if (!row) return { ready: 0, down: 0 }
  const ready = whatsappReady(
    { status: row.status, lastSeenAt: row.last_seen_at },
    new Date(now),
  )
  const deliberate = DELIBERATE.includes(row.status)
  return { ready: ready ? 1 : 0, down: ready || deliberate ? 0 : 1 }
}

/** Reserved .test addresses, dev seeds. */
async function seedAccounts(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM users WHERE lower(email) LIKE '%.test'",
  )
  return rows[0]?.n ?? 0
}

type Archiver = { lastArchived: Date | null; lastFailed: Date | null }

/** Stale, missing or failing archive. */
export function archiveFailing(archiver: Archiver, now: number): boolean {
  const { lastArchived, lastFailed } = archiver
  if (!lastArchived) return true
  if (lastFailed && lastFailed > lastArchived) return true
  return now - lastArchived.getTime() > ARCHIVE_LIMIT_MS
}

/** Age per kind, -1 missing. */
async function backupChecks(
  pool: Pool,
  now: number,
): Promise<{ checks: Record<string, number>; ok: boolean }> {
  const checks: Record<string, number> = {}
  const { rows } = await pool.query<{ kind: BackupKind; age: number }>(
    `SELECT kind, extract(epoch FROM now() - max(finished_at))::int AS age
     FROM backup_runs GROUP BY kind`,
  )
  let stale = 0
  for (const kind of BACKUP_KINDS) {
    const age = rows.find((row) => row.kind === kind)?.age ?? -1
    checks[`backup_${kind}_age_s`] = age
    if (age < 0 || age > BACKUP_LIMIT_S[kind]) stale++
  }
  checks.backup_stale = stale
  const { rows: archiver } = await pool.query<{
    last_archived_time: Date | null
    last_failed_time: Date | null
  }>("SELECT last_archived_time, last_failed_time FROM pg_stat_archiver")
  const failing = archiveFailing(
    {
      lastArchived: archiver[0]?.last_archived_time ?? null,
      lastFailed: archiver[0]?.last_failed_time ?? null,
    },
    now,
  )
  checks.wal_archive_failing = failing ? 1 : 0
  return { checks, ok: stale === 0 && !failing }
}

async function readJobs(
  pool: Pool,
  db: Db,
  backups: boolean,
  now: number,
): Promise<JobsHealth> {
  const checks: Record<string, number> = {}
  let ok = true
  for (const [queue, limit] of Object.entries(OLDEST_READY_LIMIT)) {
    const { rows } = await pool.query<{ age: number }>(OLDEST_READY_SQL, [
      queue,
    ])
    const age = rows[0]?.age ?? 0
    checks[`${queue}_oldest_ready_s`] = age
    if (age > limit) ok = false
  }
  for (const queue of DEAD_LETTER_QUEUES) {
    const { rows } = await pool.query<{ n: number }>(DEAD_SQL, [queue])
    const n = rows[0]?.n ?? 0
    checks[queue] = n
    if (n > 0) ok = false
  }
  for (const [queue, check] of Object.entries(CRON_FAILED)) {
    const { rows } = await pool.query<{ n: number }>(CRON_FAILED_SQL, [queue])
    const n = rows[0]?.n ?? 0
    checks[check] = n
    if (n > 0) ok = false
  }
  const { stale, lateTakedowns } = await tenantChecks(pool, db)
  checks.dashboard_snapshot_stale = stale
  checks.takedown_late = lateTakedowns
  // ADR-07: national view 1 h
  checks.national_stale = (await nationalStale(pool)) ? 1 : 0
  if (stale > 0 || lateTakedowns > 0 || checks.national_stale > 0) ok = false
  checks.email_quota_used = await emailsToday(pool, now)
  if (checks.email_quota_used >= EMAIL_ALERT_USED) ok = false
  // Daftar by email refused
  checks.email_signup_used = await emailSignUps(pool)
  if (checks.email_signup_used >= EMAIL_QUOTA.signUpPerDay) ok = false
  const whatsapp = await whatsappChecks(pool, now)
  checks.whatsapp_ready = whatsapp.ready
  checks.whatsapp_down = whatsapp.down
  if (whatsapp.down > 0) ok = false
  if (backups) {
    const found = await backupChecks(pool, now)
    Object.assign(checks, found.checks)
    if (!found.ok) ok = false
    // ASVS V6.3.2: no default accounts
    checks.seed_accounts = await seedAccounts(pool)
    if (checks.seed_accounts > 0) ok = false
  }
  return { ok, checks }
}

type HealthOptions = {
  // Production: archiver and backup_runs
  backups?: boolean
  now?: () => number
}

/** Checks over the web pool. */
export function poolHealth(
  pool: Pool,
  db: Db,
  options: HealthOptions = {},
): HealthChecks {
  const now = options.now ?? Date.now
  const backups = options.backups ?? false
  let cached: { at: number; value: Promise<JobsHealth> } | undefined
  return {
    async db() {
      await withDeadline(pool.query("SELECT 1"), DB_DEADLINE_MS)
    },
    jobs() {
      const at = now()
      if (!cached || at - cached.at >= CACHE_MS) {
        const value = readJobs(pool, db, backups, at)
        cached = { at, value }
        // Do not cache failures
        value.catch(() => {
          cached = undefined
        })
      }
      return cached.value
    },
  }
}
