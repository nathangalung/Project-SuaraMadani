import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { count, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { PgBoss } from "pg-boss"
import { createDatabase, database, schema } from "./client.server.ts"
import { sendJob } from "./jobs.server.ts"
import { migrate } from "./migrate.ts"
import { auditLog } from "./schema/audit.ts"
import { evidence, reportContacts, reports } from "./schema/reports.ts"
import {
  getTenantByHost,
  nextCounter,
  normalizeHost,
  pgError,
  withTenant,
} from "./tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "./testing.ts"

// Reachable without RLS by design
const ALLOWLIST = new Set([
  "users",
  "sessions",
  "accounts",
  "verifications",
  "two_factors",
  "passkeys",
  "members",
  "invitations",
  "organizations",
  "regions",
  // Keyed by address hash
  "email_log",
  // Phone hash, platform sender
  "whatsapp_log",
  "whatsapp_sender",
  // Sealed with worker key
  "whatsapp_auth",
  // Suppressed counts, db/national.test.ts
  "national_aggregates",
  // Ops markers, db/backups.test.ts
  "backup_runs",
  // PostGIS reference data
  "spatial_ref_sys",
  "geometry_columns",
  "geography_columns",
])

const TENANT_TABLES = [
  "org_counters",
  "reports",
  "report_contacts",
  "evidence",
  "issues",
  "issue_reports",
  "audit_log",
  "dashboard_snapshots",
  "follows",
  "notifications",
  "referrals",
  "responses",
  "issue_events",
  "moderation_decisions",
  "content_complaints",
  "takedowns",
  "redaction_originals",
  "demands",
  "demand_items",
  "demand_updates",
  "demand_issues",
  "demand_follows",
  "demand_ratings",
  "demand_rankings",
  "policy_briefs",
]

const su = superuserPool()
let orgA = ""
let orgB = ""
let userA = ""
let userB = ""
let reportA = ""
let reportB = ""

function sqlState(error: unknown): string | undefined {
  return pgError(error)?.code
}

async function insertReport(orgId: string, userId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const [row] = await tx
      .insert(reports)
      .values(reportValues(orgId, userId))
      .returning({ id: reports.id })
    if (!row) throw new Error("no report")
    return row.id
  })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  userA = await insertUser(su, "a@example.test")
  userB = await insertUser(su, "b@example.test")
  reportA = await insertReport(orgA, userA)
  reportB = await insertReport(orgB, userB)
})

afterAll(async () => {
  await su.end()
})

describe("catalog", () => {
  test("every table the app roles reach has FORCE RLS or is allowlisted", async () => {
    const { rows } = await su.query<{
      relname: string
      rls: boolean
      force: boolean
      has_org: boolean
      policies: number
    }>(`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
        EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
          AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org,
        (SELECT count(*)::int FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND EXISTS (SELECT 1 FROM unnest(ARRAY['sm_app', 'sm_media']) r
          WHERE has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
             OR has_any_column_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
    `)
    const unprotected = rows
      .filter((r) => !(r.rls && r.force && r.has_org && r.policies > 0))
      .map((r) => r.relname)
      .filter((name) => !ALLOWLIST.has(name))
    expect(unprotected).toEqual([])
    const protectedTables = rows
      .filter((r) => r.rls && r.force)
      .map((r) => r.relname)
    expect(protectedTables.sort()).toEqual([...TENANT_TABLES].sort())
  })

  test("app roles cannot bypass RLS or own tables", async () => {
    const { rows } = await su.query<{ rolname: string; bypass: boolean }>(
      `SELECT rolname, rolbypassrls AS bypass FROM pg_roles
       WHERE rolname IN ('sm_app', 'sm_media', 'sm_migrator')`,
    )
    expect(rows.every((r) => !r.bypass)).toBe(true)
    const owned = await su.query(
      `SELECT 1 FROM pg_class WHERE relowner IN
        (SELECT oid FROM pg_roles WHERE rolname IN ('sm_app', 'sm_media'))`,
    )
    expect(owned.rowCount).toBe(0)
  })

  test("migrate is idempotent", async () => {
    await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  })

  test("dead letters are kept 30 days, /privasi", async () => {
    const { rows } = await su.query<{ name: string; days: number }>(
      "SELECT name, retention_seconds / 86400 AS days FROM pgboss.queue WHERE name LIKE '%-dlq' ORDER BY name",
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((row) => row.days !== 30)).toEqual([])
  })
})

describe("tenant isolation as sm_app", () => {
  test("a query without a tenant fails loudly", async () => {
    const read = database().db.select().from(reports)
    expect(String(await read.catch((e) => e?.cause ?? e))).toContain(
      "app.org_id is not set",
    )
    const write = database()
      .db.insert(reports)
      .values(reportValues(orgA, userA))
    expect(String(await write.catch((e) => e?.cause ?? e))).toContain(
      "app.org_id is not set",
    )
  })

  test("reads only the current org", async () => {
    const ids = await withTenant(orgA, (tx) =>
      tx.select({ id: reports.id }).from(reports),
    )
    expect(ids.map((r) => r.id)).toEqual([reportA])
  })

  test("refuses a write into another org", async () => {
    const insert = withTenant(orgA, (tx) =>
      tx.insert(reports).values(reportValues(orgB, userA)),
    )
    expect(sqlState(await insert.catch((e) => e))).toBe("42501")
  })

  test("cannot update or delete another org's rows", async () => {
    const updated = await withTenant(orgA, (tx) =>
      tx
        .update(reports)
        .set({ title: "Diubah oleh kampus lain" })
        .where(eq(reports.id, reportB))
        .returning({ id: reports.id }),
    )
    expect(updated).toEqual([])
    const rows = await withTenant(orgB, (tx) =>
      tx.select({ title: reports.title }).from(reports),
    )
    expect(rows[0]?.title).not.toBe("Diubah oleh kampus lain")
  })

  test("child rows cannot point at another org's report", async () => {
    const insert = withTenant(orgA, (tx) =>
      tx.insert(evidence).values({
        orgId: orgA,
        reportId: reportB,
        position: 0,
        kind: "image",
        declaredName: "foto.jpg",
        declaredType: "image/jpeg",
        declaredSize: 1000,
      }),
    )
    expect(sqlState(await insert.catch((e) => e))).toBe("23503")
  })

  test("a pooled connection fails loudly after a tenant transaction", async () => {
    const pool = new Pool({
      connectionString: testUrl("TEST_DATABASE_URL"),
      max: 1,
    })
    const db = drizzle({ client: pool, schema })
    try {
      await withTenant(orgA, (tx) => tx.select().from(reports), { db })
      // Setting reverts to empty string
      const reused = await db
        .select()
        .from(reports)
        .catch((e) => e?.cause ?? e)
      expect(String(reused)).toContain("app.org_id is not set")
    } finally {
      await pool.end()
    }
  })

  test("the owner is subject to FORCE", async () => {
    const pool = new Pool({
      connectionString: testUrl("TEST_DATABASE_MIGRATOR_URL"),
      max: 1,
    })
    try {
      const read = await pool
        .query("SELECT 1 FROM reports")
        .catch((e: unknown) => e)
      expect(sqlState(read)).toBe("42501")
      expect(String(read)).toContain("app.org_id is not set")
    } finally {
      await pool.end()
    }
  })
})

describe("constraints", () => {
  test("status must be a shared/status.ts value", async () => {
    const insert = insertReport(orgA, userA).then(() =>
      withTenant(orgA, (tx) =>
        tx
          .insert(reports)
          .values(
            reportValues(orgA, userA, { status: "bogus" as "submitted" }),
          ),
      ),
    )
    expect(sqlState(await insert.catch((e) => e))).toBe("23514")
  })

  test("a report without the 18+ consent is refused", async () => {
    const insert = withTenant(orgA, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(orgA, userA, { consents: ["accurate"] })),
    )
    expect(sqlState(await insert.catch((e) => e))).toBe("23514")
  })

  test("the retired moderator role is refused", async () => {
    const pool = database().pool
    const member = pool.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'moderator')",
      [orgA, userA],
    )
    expect(sqlState(await member.catch((e) => e))).toBe("23514")
    const invite = pool.query(
      `INSERT INTO invitations (organization_id, email, role, status, expires_at, inviter_id)
       VALUES ($1, 'x@example.test', 'moderator', 'pending', now(), $2)`,
      [orgA, userA],
    )
    expect(sqlState(await invite.catch((e) => e))).toBe("23514")
  })

  test("a user without the age declaration is refused", async () => {
    const insert = database().pool.query(
      "INSERT INTO users (name, email) VALUES ('', 'minor@example.test')",
    )
    expect(sqlState(await insert.catch((e) => e))).toBe("23502")
  })

  test("audit_log is append-only", async () => {
    const [row] = await withTenant(orgA, (tx) =>
      tx
        .insert(auditLog)
        .values({ orgId: orgA, action: "report.submit", entityType: "report" })
        .returning({ id: auditLog.id }),
    )
    const id = row?.id ?? ""
    // sm_app lacks the grant
    const update = withTenant(orgA, (tx) =>
      tx.update(auditLog).set({ action: "x" }).where(eq(auditLog.id, id)),
    )
    expect(sqlState(await update.catch((e) => e))).toBe("42501")
    // The owner hits the trigger
    const owner = createDatabase(
      testUrl("TEST_DATABASE_MIGRATOR_URL"),
      "migrate",
    )
    try {
      for (const change of [
        sql`UPDATE audit_log SET action = 'x' WHERE id = ${id}`,
        sql`DELETE FROM audit_log WHERE id = ${id}`,
      ]) {
        const run = withTenant(orgA, (tx) => tx.execute(change), {
          db: owner.db,
        })
        const error = await run.catch((e: unknown) => e)
        // Owner allowed: trigger raises
        expect(sqlState(error)).toBe("42501")
        expect(String((error as Error).cause)).toContain("append-only")
      }
    } finally {
      await owner.pool.end()
    }
  })
})

describe("PostGIS point", () => {
  test("round-trips with SRID 4326", async () => {
    const values = reportValues(orgA, userA, {
      point: { lng: 107.6107, lat: -6.8915 },
    })
    const [row] = await withTenant(orgA, async (tx) => {
      await tx.insert(reports).values(values)
      return tx
        .select({
          point: reports.point,
          srid: sql<number>`ST_SRID(${reports.point})`,
        })
        .from(reports)
        .where(eq(reports.submissionId, values.submissionId))
    })
    expect(row).toEqual({ point: { lng: 107.6107, lat: -6.8915 }, srid: 4326 })
  })
})

describe("report_contacts", () => {
  test("reporter inserts but cannot read back; admin can", async () => {
    await withTenant(
      orgA,
      (tx) =>
        tx.insert(reportContacts).values({
          orgId: orgA,
          reportId: reportA,
          phone: "+628123456789",
          method: "whatsapp",
        }),
      { role: "reporter" },
    )
    const asReporter = await withTenant(
      orgA,
      (tx) => tx.select().from(reportContacts),
      { role: "reporter" },
    )
    expect(asReporter).toEqual([])
    const asEditor = await withTenant(
      orgA,
      (tx) => tx.select().from(reportContacts),
      { role: "editor" },
    )
    expect(asEditor).toEqual([])
    const asAdmin = await withTenant(
      orgA,
      (tx) => tx.select({ phone: reportContacts.phone }).from(reportContacts),
      { role: "admin" },
    )
    expect(asAdmin).toEqual([{ phone: "+628123456789" }])
    // Old images set this role
    const asRetired = await withTenant(orgA, async (tx) => {
      await tx.execute(
        sql`select set_config('app.member_role', 'moderator', true)`,
      )
      return tx.select().from(reportContacts)
    })
    expect(asRetired).toEqual([])
    const otherOrg = await withTenant(
      orgB,
      (tx) => tx.select().from(reportContacts),
      { role: "admin" },
    )
    expect(otherOrg).toEqual([])
  })
})

describe("concurrency", () => {
  test("idempotent submit: one report per submission_id", async () => {
    const values = reportValues(orgA, userA)
    const submit = (publicCode: string) =>
      withTenant(orgA, async (tx) => {
        const rows = await tx
          .insert(reports)
          .values({ ...values, publicCode })
          .onConflictDoNothing({
            target: [reports.orgId, reports.userId, reports.submissionId],
          })
          .returning({ id: reports.id })
        await Bun.sleep(100)
        return rows
      })
    const [first, second] = await Promise.all([
      submit("T-26-AAAA1"),
      submit("T-26-AAAA2"),
    ])
    expect((first?.length ?? 0) + (second?.length ?? 0)).toBe(1)
    const [stored] = await withTenant(orgA, (tx) =>
      tx
        .select({ n: count() })
        .from(reports)
        .where(eq(reports.submissionId, values.submissionId)),
    )
    expect(stored?.n).toBe(1)
  })

  test("concurrent merges get distinct issue numbers", async () => {
    const allocate = () =>
      withTenant(orgA, async (tx) => {
        const n = await nextCounter(
          tx,
          orgA,
          { year: 2026, month: 10 },
          "issue",
        )
        await Bun.sleep(100)
        return n
      })
    const numbers = await Promise.all([allocate(), allocate(), allocate()])
    expect([...numbers].sort()).toEqual([1, 2, 3])
  })

  test("a rolled-back allocation returns its number", async () => {
    const failed = withTenant(orgB, async (tx) => {
      await nextCounter(tx, orgB, { year: 2026, month: 10 }, "issue")
      throw new Error("merge failed")
    })
    await expect(failed).rejects.toThrow("merge failed")
    const n = await withTenant(orgB, (tx) =>
      nextCounter(tx, orgB, { year: 2026, month: 10 }, "issue"),
    )
    expect(n).toBe(1)
  })

  test("each month and kind counts from 1", async () => {
    const next = (month: number, kind: "issue" | "report") =>
      withTenant(orgA, (tx) =>
        nextCounter(tx, orgA, { year: 2027, month }, kind),
      )
    expect(await next(1, "report")).toBe(1)
    expect(await next(1, "report")).toBe(2)
    expect(await next(2, "report")).toBe(1)
    expect(await next(1, "issue")).toBe(1)
  })
})

describe("withTenant retries", () => {
  test("reruns the transaction on a report code collision", async () => {
    let attempts = 0
    const codes = ["T-26-DUP01", "T-26-NEW01"]
    await insertReportWithCode("T-26-DUP01")
    await withTenant(orgA, async (tx) => {
      const publicCode = codes[attempts++] ?? "T-26-NEW02"
      await tx.insert(reports).values(reportValues(orgA, userA, { publicCode }))
    })
    expect(attempts).toBe(2)
  })

  test("gives up after three collisions", async () => {
    let attempts = 0
    await insertReportWithCode("T-26-DUP02")
    const run = withTenant(orgA, async (tx) => {
      attempts++
      await tx
        .insert(reports)
        .values(reportValues(orgA, userA, { publicCode: "T-26-DUP02" }))
    })
    expect(sqlState(await run.catch((e) => e))).toBe("23505")
    expect(attempts).toBe(3)
  })

  test("other unique violations are not retried", async () => {
    let attempts = 0
    const values = reportValues(orgA, userA)
    await withTenant(orgA, (tx) => tx.insert(reports).values(values))
    const run = withTenant(orgA, async (tx) => {
      attempts++
      await tx.insert(reports).values({ ...values, publicCode: "T-26-OTHER" })
    })
    expect(sqlState(await run.catch((e) => e))).toBe("23505")
    expect(attempts).toBe(1)
  })
})

async function insertReportWithCode(publicCode: string): Promise<void> {
  await withTenant(orgA, (tx) =>
    tx.insert(reports).values(reportValues(orgA, userA, { publicCode })),
  )
}

describe("pg-boss outbox", () => {
  const jobCount = async () => {
    const { rows } = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'evidence'",
    )
    return rows[0]?.n ?? 0
  }

  test("a job commits and rolls back with the tenant transaction", async () => {
    await database().boss.start()
    const before = await jobCount()
    const failed = withTenant(orgA, async (tx) => {
      await sendJob(tx, "evidence", { orgId: orgA, evidenceId: reportA })
      throw new Error("rollback")
    })
    await expect(failed).rejects.toThrow("rollback")
    expect(await jobCount()).toBe(before)
    await withTenant(orgA, (tx) =>
      sendJob(tx, "evidence", { orgId: orgA, evidenceId: reportA }),
    )
    expect(await jobCount()).toBe(before + 1)
  })
})

describe("sm_media", () => {
  test("touches only its own queues", async () => {
    await su.query(
      "INSERT INTO pgboss.job (name, data) VALUES ('takedown', '{}'), ('evidence', '{}')",
    )
    const client = await su.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE sm_media")
      const gone = await client.query(
        "DELETE FROM pgboss.job_common WHERE name = 'takedown'",
      )
      expect(gone.rowCount).toBe(0)
      const delayed = await client.query(
        "UPDATE pgboss.job_common SET start_after = now() + interval '1 day' WHERE name IN ('takedown', 'email-send')",
      )
      expect(delayed.rowCount).toBe(0)
      const own = await client.query(
        "UPDATE pgboss.job_common SET priority = priority WHERE name = 'evidence'",
      )
      expect(own.rowCount).toBeGreaterThan(0)
      for (const statement of [
        "INSERT INTO pgboss.job_common (name, data) VALUES ('takedown', '{}')",
        "DELETE FROM pgboss.job WHERE name = 'takedown'",
        "UPDATE pgboss.queue SET retry_limit = 0",
      ]) {
        await client.query("SAVEPOINT s")
        const denied = await client.query(statement).catch((e: unknown) => e)
        expect([statement, sqlState(denied)]).toEqual([statement, "42501"])
        await client.query("ROLLBACK TO SAVEPOINT s")
      }
    } finally {
      await client.query("ROLLBACK")
      client.release()
      await su.query(
        "DELETE FROM pgboss.job WHERE name IN ('takedown', 'evidence') AND data = '{}'",
      )
    }
  })

  test("pg-boss works its queues, DLQ included", async () => {
    // Queue holds only this job
    await su.query("DELETE FROM pgboss.job WHERE name = 'evidence'")
    const sender = database().boss
    await sender.start()
    const id = await sender.send(
      "evidence",
      { orgId: orgA, evidenceId: reportA, reqId: "media-dlq" },
      { retryLimit: 0 },
    )
    const roleUrl = new URL(testUrl("TEST_DATABASE_SUPERUSER_URL"))
    roleUrl.searchParams.set("options", "-c role=sm_media")
    // Every session as sm_media
    const worker = new PgBoss({
      connectionString: roleUrl.toString(),
      max: 2,
      supervise: false,
      schedule: false,
      migrate: false,
      createSchema: false,
    })
    worker.on("error", () => {})
    await worker.start()
    try {
      const [job] = await worker.fetch("evidence")
      expect(job?.id).toBe(id ?? "")
      await worker.fail("evidence", job?.id ?? "", { reason: "test" })
      const { rows } = await su.query(
        "SELECT 1 FROM pgboss.job WHERE name = 'evidence-dlq' AND data->>'reqId' = 'media-dlq'",
      )
      expect(rows).toHaveLength(1)
    } finally {
      await worker.stop({ graceful: false })
      await su.query(
        "DELETE FROM pgboss.job WHERE data->>'reqId' = 'media-dlq'",
      )
    }
  })

  test("reads evidence only, never reports or contacts", async () => {
    const client = await su.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE sm_media")
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgA])
      await client.query("SELECT id, status FROM evidence")
      await client.query("SAVEPOINT s")
      const denied = await client
        .query("SELECT id FROM reports")
        .catch((e: unknown) => e)
      expect(sqlState(denied)).toBe("42501")
      await client.query("ROLLBACK TO SAVEPOINT s")
      const contacts = await client
        .query("SELECT phone FROM report_contacts")
        .catch((e: unknown) => e)
      expect(sqlState(contacts)).toBe("42501")
      await client.query("ROLLBACK TO SAVEPOINT s")
      const hosts = await client.query("SELECT id, host FROM organizations")
      expect(hosts.rowCount).toBeGreaterThan(0)
      const theme = await client
        .query("SELECT theme FROM organizations")
        .catch((e: unknown) => e)
      expect(sqlState(theme)).toBe("42501")
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })

  test("writes outputs, never the admin decision", async () => {
    const client = await su.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE sm_media")
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgA])
      await client.query(
        "UPDATE evidence SET public_media = '[]', preview_pages = 1, failure_reason = NULL, duration_ms = 1, width = 1, height = 1, source_pages = 1",
      )
      await client.query("SELECT id, published_at FROM issues")
      await client.query("SAVEPOINT s")
      const title = await client
        .query("SELECT title FROM issues")
        .catch((e: unknown) => e)
      expect(sqlState(title)).toBe("42501")
      await client.query("ROLLBACK TO SAVEPOINT s")
      for (const column of ["decision", "redaction_boxes", "decided_by"]) {
        await client.query("SAVEPOINT s")
        const denied = await client
          .query(`UPDATE evidence SET ${column} = NULL`)
          .catch((e: unknown) => e)
        expect(sqlState(denied)).toBe("42501")
        await client.query("ROLLBACK TO SAVEPOINT s")
      }
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })
})

describe("getTenantByHost", () => {
  test("normalizes the Host header", () => {
    expect(normalizeHost("ITB.Localhost:5173")).toBe("itb.localhost")
    expect(normalizeHost("itb.localhost.")).toBe("itb.localhost")
  })

  test("finds the org by host and caches it", async () => {
    const now = () => 1_000
    const tenant = await getTenantByHost("itb.localhost:5173", { now })
    expect(tenant?.id).toBe(orgA)
    expect(tenant?.campusCode).toBe("ITB")
    await su.query(
      "UPDATE organizations SET campus_name = 'baru' WHERE id = $1",
      [orgA],
    )
    const cached = await getTenantByHost("itb.localhost", { now })
    expect(cached?.campusName).toBe("itb")
    const fresh = await getTenantByHost("itb.localhost", { now: () => 70_000 })
    expect(fresh?.campusName).toBe("baru")
  })

  test("unknown host is undefined", async () => {
    expect(await getTenantByHost("nope.localhost")).toBeUndefined()
  })
})

describe("separate pool per profile", () => {
  test("web pool applies the statement timeout", async () => {
    const { pool } = createDatabase(testUrl("TEST_DATABASE_URL"), "web")
    try {
      const { rows } = await pool.query<{ statement_timeout: string }>(
        "SHOW statement_timeout",
      )
      expect(rows[0]?.statement_timeout).toBe("5s")
      const { rows: tx } = await pool.query<{ transaction_timeout: string }>(
        "SHOW transaction_timeout",
      )
      expect(tx[0]?.transaction_timeout).toBe("15s")
      expect(
        await database().db.execute(sql`select current_user`),
      ).toHaveProperty("rows.0.current_user", "sm_app")
    } finally {
      await pool.end()
    }
  })
})
