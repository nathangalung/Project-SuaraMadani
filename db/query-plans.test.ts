import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "./migrate.ts"
import { reports } from "./schema/reports.ts"
import { withTenant } from "./tenant.server.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  superuserPool,
  testUrl,
} from "./testing.ts"

const su = superuserPool()

type PlanNode = {
  "Node Type": string
  "Index Name"?: string
  "Index Cond"?: string
  Plans?: PlanNode[]
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)]
}

/** Plan as sm_app under RLS. */
async function plan(query: string): Promise<PlanNode[]> {
  const result = await withTenant(crypto.randomUUID(), async (tx) => {
    // Force any matching index
    await tx.execute(sql`SET LOCAL enable_seqscan = off`)
    await tx.execute(sql`SET LOCAL enable_bitmapscan = off`)
    await tx.execute(sql`SET LOCAL enable_sort = off`)
    return tx.execute(sql.raw(`EXPLAIN (FORMAT JSON) ${query}`)) // sql-raw-ok: test queries
  })
  const [row] = result.rows as { "QUERY PLAN": [{ Plan: PlanNode }] }[]
  if (!row) throw new Error("no plan")
  return flatten(row["QUERY PLAN"][0].Plan)
}

const nodeTypes = (nodes: PlanNode[]) => nodes.map((n) => n["Node Type"])
const indexNames = (nodes: PlanNode[]) =>
  nodes.flatMap((n) => (n["Index Name"] ? [n["Index Name"]] : []))

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await insertRegions(su)
})

afterAll(async () => {
  await su.end()
})

// Mirrors issues.server.ts SORT_COLUMN
describe("public issue list", () => {
  const sorts = [
    [
      "terbaru",
      "published_at",
      "'2026-10-01'::timestamptz",
      "issues_published_idx",
    ],
    [
      "aktivitas",
      "last_activity_at",
      "'2026-10-01'::timestamptz",
      "issues_activity_idx",
    ],
    ["laporan", "report_count", "5::int", "issues_report_count_idx"],
  ] as const

  test.each(sorts)(
    "%s reads in index order",
    async (_, column, _key, index) => {
      const page = `SELECT id FROM issues WHERE published_at IS NOT NULL
      ORDER BY ${column} DESC, id DESC LIMIT 21`
      const nodes = await plan(page)
      expect(nodeTypes(nodes)).not.toContain("Sort")
      expect(indexNames(nodes)).toEqual([index])
    },
  )

  test.each(sorts)(
    "%s keyset page stays in the index",
    async (_, column, key, index) => {
      const next = `SELECT id FROM issues WHERE published_at IS NOT NULL
      AND (${column}, id) < (${key}, '${crypto.randomUUID()}'::uuid)
      ORDER BY ${column} DESC, id DESC LIMIT 21`
      const nodes = await plan(next)
      expect(nodeTypes(nodes)).not.toContain("Sort")
      expect(indexNames(nodes)).toEqual([index])
    },
  )
})

describe("moderation merge targets", () => {
  test("latest activity reads in index order", async () => {
    // Mirrors listMergeTargets, unpublished too
    const nodes = await plan(
      "SELECT id FROM issues ORDER BY last_activity_at DESC LIMIT 50",
    )
    expect(nodeTypes(nodes)).not.toContain("Sort")
    expect(indexNames(nodes)).toEqual(["issues_activity_idx"])
  })
})

// Cascade deletes look these up
describe("foreign key lookups", () => {
  const id = () => `'${crypto.randomUUID()}'::uuid`
  test.each([
    ["notifications", "report_id", "notifications_report_idx"],
    ["notifications", "issue_id", "notifications_issue_idx"],
    ["notifications", "complaint_id", "notifications_complaint_idx"],
    ["issue_events", "referral_id", "issue_events_referral_idx"],
    ["issue_events", "response_id", "issue_events_response_idx"],
  ] as const)("%s.%s uses its index", async (table, column, index) => {
    const nodes = await plan(
      `SELECT 1 FROM ${table} WHERE org_id = current_org_id() AND ${column} = ${id()}`,
    )
    expect(indexNames(nodes)).toEqual([index])
    const [scan] = nodes.filter((n) => n["Index Name"] === index)
    expect(scan?.["Index Cond"]).toContain(column)
  })

  test("user SET NULL finds rows without RLS", async () => {
    // RI triggers skip RLS
    const client = await su.connect()
    try {
      await client.query("BEGIN")
      await client.query("SET LOCAL enable_seqscan = off")
      await client.query("SET LOCAL enable_bitmapscan = off")
      const { rows } = await client.query<{
        "QUERY PLAN": [{ Plan: PlanNode }]
      }>(
        `EXPLAIN (FORMAT JSON) SELECT 1 FROM notifications WHERE user_id = ${id()}`,
      )
      await client.query("ROLLBACK")
      const top = rows[0]?.["QUERY PLAN"][0].Plan
      expect(indexNames(top ? flatten(top) : [])).toEqual([
        "notifications_user_idx",
      ])
    } finally {
      client.release()
    }
  })
})

describe("upload byte cap", () => {
  test("reads only the last day's evidence", async () => {
    const slug = `plan${String(Date.now()).slice(-5)}`
    const org = await insertOrg(su, slug)
    const user = await insertUser(su, `${slug}@example.test`)
    const [report] = await withTenant(org, (tx) =>
      tx
        .insert(reports)
        .values(reportValues(org, user))
        .returning({ id: reports.id }),
    )
    const client = await su.connect()
    try {
      // A month of history, analyzed
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO reports SELECT (jsonb_populate_record(r, jsonb_build_object(
           'id', uuidv7(), 'public_code', 'T-26-' || g, 'submission_id', gen_random_uuid()))).*
         FROM reports r, generate_series(1, 400) g WHERE r.id = $1`,
        [report?.id],
      )
      await client.query(
        `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
           declared_type, declared_size, status, byte_size, received_at)
         SELECT org_id, id, p, 'image', 'a.jpg', 'image/jpeg', 10, 'received', 10,
           now() - interval '30 days'
         FROM reports, generate_series(0, 4) p WHERE org_id = $1`,
        [org],
      )
      await client.query("ANALYZE evidence")
      await client.query("SET LOCAL ROLE sm_app")
      await client.query("SELECT set_config('app.org_id', $1, true)", [org])
      // Mirrors upload.server.ts usage query
      const { rows } = await client.query<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT coalesce(sum(byte_size), 0) FROM evidence WHERE received_at > now() - interval '24 hours'",
      )
      const text = rows.map((r) => r["QUERY PLAN"]).join("\n")
      expect(text).toContain("Index Scan using evidence_received_idx")
      expect(text).toMatch(/Index Cond: .*received_at >/)
    } finally {
      await client.query("ROLLBACK")
      client.release()
      await su.query("DELETE FROM reports WHERE org_id = $1", [org])
      await su.query("DELETE FROM users WHERE id = $1", [user])
      await su.query("DELETE FROM organizations WHERE id = $1", [org])
    }
  })
})
