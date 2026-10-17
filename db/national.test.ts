import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { MIN_PUBLIC_N } from "../shared/dashboard.ts"
import { createDatabase, schema } from "./client.server.ts"
import { migrate } from "./migrate.ts"
import { issues } from "./schema/issues.ts"
import { reports } from "./schema/reports.ts"
import { pgError, withTenant } from "./tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "./testing.ts"

// Spike P4 on PostgreSQL 18
const su = superuserPool()
const suDb = drizzle({ client: su, schema })
// Real sm_app login
const app = createDatabase(testUrl("TEST_DATABASE_URL"), "worker")

type Cell = {
  dimension: string
  key: string
  received: number | null
  issues: number | null
  issue_reports: number | null
}

let orgA = ""
let orgB = ""
let orgC = ""
let number = 0

async function publish(
  orgId: string,
  count: number,
  category: "program" | "bencana",
  status = "awaiting_response",
) {
  const sub = category === "program" ? "program.pendidikan" : "bencana.banjir"
  for (let i = 0; i < count; i++) {
    number++
    await su.query(
      `INSERT INTO issues (org_id, year, number, public_code, title, summary,
        category_id, subcategory_id, province_code, regency_code, gov_status,
        report_count, published_at)
       VALUES ($1, 2026, $2, $3, 'Isu uji', 'Ringkasan', $4, $5, '32', '32.73', $6, 2, now())`,
      [orgId, number, `N-${number}`, category, sub, status],
    )
  }
}

async function refreshAsApp(): Promise<void> {
  await app.db.execute(
    sql`REFRESH MATERIALIZED VIEW public.national_aggregates`,
  )
}

async function cells(): Promise<Cell[]> {
  const result = await app.db.execute<Cell>(
    sql`SELECT dimension, key, received, issues, issue_reports
        FROM public.national_aggregates`,
  )
  return result.rows
}

function cell(rows: Cell[], dimension: string, key: string): Cell | undefined {
  return rows.find((row) => row.dimension === dimension && row.key === key)
}

function stateOf(error: unknown): string | undefined {
  return pgError(error)?.code
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "nasa")
  orgB = await insertOrg(su, "nasb")
  orgC = await insertOrg(su, "nasc")
  const user = await insertUser(su, "nasional@example.test")
  // A: one forwarded out
  for (let i = 0; i < 6; i++) {
    await suDb
      .insert(reports)
      .values(reportValues(orgA, user, { publicCode: `NA-26-${i}` }))
  }
  await su.query(
    "UPDATE reports SET status = 'forwarded', forwarded_to_org_id = $2 WHERE org_id = $1 AND public_code = 'NA-26-0'",
    [orgA, orgB],
  )
  // A: 5 program, 3 bencana
  await publish(orgA, 5, "program", "confirmed_resolved")
  await publish(orgA, 3, "bencana")
  // B: one issue, one draft
  await publish(orgB, 1, "program")
  await su.query(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
      category_id, subcategory_id, province_code, regency_code, report_count)
     VALUES ($1, 2026, 999, 'N-DRAFT', 'Draf', 'Ringkasan', 'program',
      'program.pendidikan', '32', '32.73', 1)`,
    [orgB],
  )
  await refreshAsApp()
})

afterAll(async () => {
  await resetData(su)
  await su.query("REFRESH MATERIALIZED VIEW public.national_aggregates")
  await app.pool.end()
  await su.end()
})

describe("national_aggregates roles", () => {
  test("owned by the NOLOGIN BYPASSRLS view role", async () => {
    const { rows } = await su.query<{
      owner: string
      login: boolean
      bypass: boolean
    }>(
      `SELECT r.rolname AS owner, r.rolcanlogin AS login, r.rolbypassrls AS bypass
       FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
       WHERE c.oid = 'public.national_aggregates'::regclass AND c.relkind = 'm'`,
    )
    expect(rows).toEqual([
      { owner: "sm_aggregates", login: false, bypass: true },
    ])
  })

  test("sm_app holds only SELECT and MAINTAIN on it", async () => {
    const { rows } = await su.query<{ privilege: string }>(
      `SELECT p.privilege_type AS privilege
       FROM pg_class c, aclexplode(c.relacl) p
       WHERE c.oid = 'public.national_aggregates'::regclass
         AND p.grantee = 'sm_app'::regrole
       ORDER BY 1`,
    )
    expect(rows.map((r) => r.privilege)).toEqual(["MAINTAIN", "SELECT"])
  })

  test("the view role cannot create objects", async () => {
    const { rows } = await su.query<{ create: boolean; member: boolean }>(
      `SELECT has_schema_privilege('sm_aggregates', 'public', 'CREATE') AS create,
        pg_has_role('sm_app', 'sm_aggregates', 'MEMBER') AS member`,
    )
    expect(rows[0]).toEqual({ create: false, member: false })
  })

  test("sm_app cannot become the view role", async () => {
    const error = await app.db
      .execute(sql`SET ROLE sm_aggregates`)
      .catch((e: unknown) => e)
    expect(stateOf(error)).toBe("42501")
  })

  test("sm_app cannot change the view", async () => {
    const error = await app.db
      .execute(
        sql`ALTER MATERIALIZED VIEW public.national_aggregates RENAME TO x`,
      )
      .catch((e: unknown) => e)
    expect(stateOf(error)).toBe("42501")
  })

  test("the view exposes counts only", async () => {
    const { rows } = await su.query<{ name: string }>(
      `SELECT attname AS name FROM pg_attribute
       WHERE attrelid = 'public.national_aggregates'::regclass
         AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    )
    expect(rows.map((r) => r.name)).toEqual([
      "dimension",
      "key",
      "received",
      "issues",
      "issue_reports",
      "demands",
      "computed_at",
    ])
  })
})

describe("national_aggregates refresh", () => {
  test("an RLS-subject owner fails loudly under FORCE", async () => {
    const client = await su.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL ROLE sm_migrator")
      await client.query(
        "CREATE MATERIALIZED VIEW public.p4_probe AS SELECT count(*) AS n FROM public.issues WITH NO DATA",
      )
      const error = await client
        .query("REFRESH MATERIALIZED VIEW public.p4_probe")
        .catch((e: unknown) => e)
      expect(stateOf(error)).toBe("42501")
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  })

  test("sm_app refreshes and sees every campus on FORCE tables", async () => {
    const rows = await cells()
    expect(cell(rows, "campus", orgA)?.issues).toBe(8)
    expect(cell(rows, "campus", orgC)?.issues).toBe(0)
    expect(cell(rows, "total", "all")?.issues).toBe(9)
    expect(cell(rows, "total", "all")?.issue_reports).toBe(18)
  })

  test("a forwarded report counts once", async () => {
    const rows = await cells()
    expect(cell(rows, "campus", orgA)?.received).toBe(5)
    expect(cell(rows, "total", "all")?.received).toBe(5)
  })

  test("small n cells are NULL, zero stays zero", async () => {
    const rows = await cells()
    // B has one issue
    expect(cell(rows, "campus", orgB)?.issues).toBeNull()
    expect(cell(rows, "campus", orgB)?.received).toBe(0)
    expect(cell(rows, "category", "bencana")?.issues).toBeNull()
    expect(cell(rows, "category", "program")?.issues).toBe(6)
    expect(cell(rows, "status", "confirmed_resolved")?.issues).toBe(
      MIN_PUBLIC_N,
    )
    expect(cell(rows, "status", "awaiting_response")?.issues).toBeNull()
    expect(cell(rows, "province", "32")?.issues).toBe(9)
    // Breakdowns carry no received count
    expect(cell(rows, "province", "32")?.received).toBeNull()
  })

  test("drafts never count", async () => {
    const rows = await cells()
    expect(rows.some((row) => row.key === "N-DRAFT")).toBe(false)
    expect(cell(rows, "category", "program")?.issues).toBe(6)
  })

  test("tenant isolation still holds for sm_app", async () => {
    const error = await app.db
      .select()
      .from(issues)
      .catch((e: unknown) => e)
    expect(
      String(error instanceof Error ? (error.cause ?? error) : error),
    ).toContain("app.org_id is not set")
    const seen = await withTenant(
      orgB,
      (tx) => tx.select({ org: issues.orgId }).from(issues),
      { db: app.db },
    )
    expect(new Set(seen.map((row) => row.org))).toEqual(new Set([orgB]))
  })

  test("computed_at is the refresh time", async () => {
    const before = await app.db.execute<{ at: Date }>(
      sql`SELECT max(computed_at) AS at FROM public.national_aggregates`,
    )
    await refreshAsApp()
    const after = await app.db.execute<{ at: Date }>(
      sql`SELECT max(computed_at) AS at FROM public.national_aggregates`,
    )
    const was = before.rows[0]?.at
    const now = after.rows[0]?.at
    expect(was && now && new Date(now) > new Date(was)).toBe(true)
  })
})
