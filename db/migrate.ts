import { sql } from "drizzle-orm"
import { migrate as runDrizzle } from "drizzle-orm/node-postgres/migrator"
import { PgBoss } from "pg-boss"
import { createDatabase } from "./client.server.ts"
import { QUEUES } from "./jobs.server.ts"

const MIGRATIONS = new URL("./migrations", import.meta.url).pathname

type Grant = { table: string; app: string; media?: string; backup?: string }

// Revoked and regranted each run
export const GRANTS: Grant[] = [
  // superadmin left out: CLI only
  {
    table: "users",
    app: "SELECT, INSERT, UPDATE (name, email, email_verified, phone_number, phone_verified, image, updated_at, two_factor_enabled, age_declared_at, age_consent_version), DELETE",
  },
  { table: "sessions", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "accounts", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "verifications", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "two_factors", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "passkeys", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "members", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "invitations", app: "SELECT, INSERT, UPDATE, DELETE" },
  {
    table: "organizations",
    app: "SELECT, INSERT, UPDATE",
    media: "SELECT (id, host)",
  },
  { table: "regions", app: "SELECT" },
  { table: "org_counters", app: "SELECT, INSERT, UPDATE" },
  // DELETE: closing a minor's account
  { table: "reports", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "report_contacts", app: "SELECT, INSERT, UPDATE, DELETE" },
  // DELETE: rejected originals, 90 days
  {
    table: "evidence",
    app: "SELECT, INSERT, UPDATE, DELETE",
    media:
      "SELECT, UPDATE (status, detected_type, byte_size, sha256, attempts, updated_at, scanned_at, failure_reason, duration_ms, width, height, source_pages, preview_pages, public_media, published_at)",
  },
  // Publish re-checks the issue
  {
    table: "issues",
    app: "SELECT, INSERT, UPDATE",
    media: "SELECT (id, org_id, published_at)",
  },
  {
    table: "issue_reports",
    app: "SELECT, INSERT, DELETE",
    media: "SELECT (org_id, issue_id, report_id)",
  },
  { table: "referrals", app: "SELECT, INSERT" },
  { table: "responses", app: "SELECT, INSERT" },
  { table: "issue_events", app: "SELECT, INSERT" },
  { table: "moderation_decisions", app: "SELECT, INSERT" },
  { table: "content_complaints", app: "SELECT, INSERT, UPDATE" },
  { table: "takedowns", app: "SELECT, INSERT, UPDATE" },
  { table: "redaction_originals", app: "SELECT, INSERT" },
  { table: "audit_log", app: "SELECT, INSERT" },
  // DELETE: drafts never published
  { table: "demands", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "demand_items", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "demand_updates", app: "SELECT, INSERT" },
  { table: "demand_issues", app: "SELECT, INSERT, DELETE" },
  { table: "demand_follows", app: "SELECT, INSERT, DELETE" },
  // UPDATE: raters change scores
  { table: "demand_ratings", app: "SELECT, INSERT, UPDATE, DELETE" },
  // DELETE: replaced or infected files
  {
    table: "policy_briefs",
    app: "SELECT, INSERT, UPDATE, DELETE",
    media:
      "SELECT (id, org_id, item_id, status, sha256), UPDATE (status, scanned_at)",
  },
  { table: "dashboard_snapshots", app: "SELECT, INSERT, UPDATE" },
  { table: "follows", app: "SELECT, INSERT, DELETE" },
  { table: "notifications", app: "SELECT, INSERT, UPDATE" },
  // DELETE: 30-day retention
  { table: "email_log", app: "SELECT, INSERT, UPDATE, DELETE" },
  // Owner sm_aggregates, refresh only
  { table: "national_aggregates", app: "SELECT, MAINTAIN" },
  // DELETE: 30-day retention
  { table: "whatsapp_log", app: "SELECT, INSERT, UPDATE, DELETE" },
  { table: "whatsapp_sender", app: "SELECT, INSERT, UPDATE" },
  // Sealed, worker-whatsapp key only
  { table: "whatsapp_auth", app: "SELECT, INSERT, UPDATE, DELETE" },
  // Health reads, wrappers insert
  { table: "backup_runs", app: "SELECT", backup: "INSERT" },
]

// worker-media queues, DLQs included
const MEDIA_QUEUES = QUEUES.map((queue) => queue.name)
  .filter((name) => name.startsWith("evidence"))
  .map((name) => `'${name}'`)
  .join(", ")

const PGBOSS_GRANTS = [
  "GRANT USAGE ON SCHEMA pgboss TO sm_app, sm_media",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO sm_app",
  "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO sm_app",
  "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO sm_app",
  // Queue partitions created later
  "ALTER DEFAULT PRIVILEGES FOR ROLE sm_migrator IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sm_app",
  "ALTER DEFAULT PRIVILEGES FOR ROLE sm_migrator IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO sm_app",
  "ALTER DEFAULT PRIVILEGES FOR ROLE sm_migrator IN SCHEMA pgboss GRANT EXECUTE ON FUNCTIONS TO sm_app",
  // Decoder exploit cannot touch takedowns
  "REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM sm_media",
  "REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgboss FROM sm_media",
  "ALTER DEFAULT PRIVILEGES FOR ROLE sm_migrator IN SCHEMA pgboss REVOKE ALL ON TABLES FROM sm_media",
  "ALTER DEFAULT PRIVILEGES FOR ROLE sm_migrator IN SCHEMA pgboss REVOKE ALL ON SEQUENCES FROM sm_media",
  "GRANT SELECT ON pgboss.queue, pgboss.version TO sm_media",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.job_common TO sm_media",
  // DLQ copies insert via parent
  "GRANT SELECT, INSERT ON pgboss.job TO sm_media",
  ...["job", "job_common"].flatMap((table) => [
    `ALTER TABLE pgboss.${table} ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS sm_app_all ON pgboss.${table}`,
    `CREATE POLICY sm_app_all ON pgboss.${table} TO sm_app USING (true) WITH CHECK (true)`,
    `DROP POLICY IF EXISTS sm_media_own ON pgboss.${table}`,
    `CREATE POLICY sm_media_own ON pgboss.${table} TO sm_media USING (name IN (${MEDIA_QUEUES})) WITH CHECK (name IN (${MEDIA_QUEUES}))`,
  ]),
]

const IDENTIFIER = /^[a-z_]+$/

function grantStatements(grant: Grant): string[] {
  if (!IDENTIFIER.test(grant.table))
    throw new Error(`Bad table: ${grant.table}`)
  const table = `public.${grant.table}`
  const statements = [
    `REVOKE ALL ON ${table} FROM PUBLIC, sm_app, sm_media, sm_backup`,
    `GRANT ${grant.app} ON ${table} TO sm_app`,
  ]
  if (grant.media)
    statements.push(`GRANT ${grant.media} ON ${table} TO sm_media`)
  if (grant.backup)
    statements.push(`GRANT ${grant.backup} ON ${table} TO sm_backup`)
  return statements
}

/** Drizzle, pg-boss, queues, grants. Idempotent. */
export async function migrate(connectionString: string): Promise<void> {
  const { pool, db } = createDatabase(connectionString, "migrate")
  try {
    await runDrizzle(db, { migrationsFolder: MIGRATIONS })
    const boss = new PgBoss({
      connectionString,
      max: 2,
      application_name: "migrate",
      supervise: false,
      schedule: false,
    })
    boss.on("error", (error) => console.error(error))
    await boss.start()
    try {
      const existing = new Set((await boss.getQueues()).map((q) => q.name))
      for (const queue of QUEUES) {
        const { name, policy: _, partition: __, ...options } = queue
        if (existing.has(name)) await boss.updateQueue(name, options)
        else await boss.createQueue(name, queue)
      }
    } finally {
      await boss.stop({ graceful: false })
    }
    await db.transaction(async (tx) => {
      for (const statement of [
        ...GRANTS.flatMap(grantStatements),
        ...PGBOSS_GRANTS,
      ]) {
        await tx.execute(sql.raw(statement)) // sql-raw-ok: built from GRANTS
      }
    })
  } finally {
    await pool.end()
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_MIGRATOR_URL
  if (!url) throw new Error("DATABASE_MIGRATOR_URL is not set")
  await migrate(url)
  console.log(JSON.stringify({ msg: "migrated" }))
}
