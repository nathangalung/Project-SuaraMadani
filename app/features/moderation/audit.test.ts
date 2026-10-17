import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { migrate } from "../../../db/migrate.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import {
  AUDIT_PAGE_SIZE,
  encodeAuditCursor,
  listAudit,
  parseAuditQuery,
} from "./audit.server.ts"

const su = superuserPool()
let orgA = ""
let orgB = ""
let moderator = ""
let reportId = ""

async function audit(
  org: string,
  action: string,
  at: string,
  entity: { type: string; id: string | null } = { type: "report", id: null },
  actor: string | null = moderator,
) {
  await su.query(
    `INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, changed_columns, reason_code, created_at)
     VALUES ($1, $2, $3, $4, $5, '{status}', 'standard_2', $6)`,
    [org, actor, action, entity.type, entity.id, at],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "aua")
  orgB = await insertOrg(su, "aub")
  moderator = await insertUser(su, "moderator.audit@contoh.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
    [orgA, moderator],
  )
  const values = reportValues(orgA, moderator, { publicCode: "AUA-26-AAAAA" })
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO reports (org_id, user_id, public_code, submission_id, relation, province_code,
       regency_code, district_code, title, story, category_id, subcategory_id, occurred_on,
       urgency, affected_groups, affected_count, ongoing, contactable, consents, consent_text_version)
     VALUES ($1, $2, $3, gen_random_uuid(), 'self', '32', '32.73', '32.73.02', $4, $5,
       'program', 'program.pendidikan', '2026-10-01', 'medium', '{general_public}', '11_100',
       'yes', false, '{age_18_plus,accurate,public_issue,aggregate_processing}', 'v1') RETURNING id`,
    [orgA, moderator, values.publicCode, values.title, values.story],
  )
  reportId = rows[0]?.id ?? ""
  await audit(orgA, "report.reject", "2026-10-10T03:00:00Z", {
    type: "report",
    id: reportId,
  })
  await audit(orgA, "issue.refer", "2026-10-12T03:00:00Z", {
    type: "issue",
    id: crypto.randomUUID(),
  })
  await audit(
    orgA,
    "report.submit",
    "2026-10-14T03:00:00Z",
    {
      type: "report",
      id: reportId,
    },
    null,
  )
  await audit(orgB, "report.reject", "2026-10-13T03:00:00Z")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
})

describe("parseAuditQuery", () => {
  test("keeps known values only", () => {
    expect(
      parseAuditQuery(
        new URLSearchParams(
          "tindakan=report.reject&data=report&dari=2026-10-01&sampai=2026-10-31",
        ),
      ),
    ).toEqual({
      action: "report.reject",
      entity: "report",
      from: "2026-10-01",
      to: "2026-10-31",
      before: null,
    })
    expect(
      parseAuditQuery(
        new URLSearchParams("tindakan=drop&data=x&dari=kemarin&sebelum=zz"),
      ),
    ).toEqual({
      action: null,
      entity: null,
      from: null,
      to: null,
      before: null,
    })
  })
})

describe("listAudit", () => {
  const none = {
    action: null,
    entity: null,
    from: null,
    to: null,
    before: null,
  }

  test("newest first, this campus only, with codes and roles", async () => {
    const page = await listAudit(orgA, "admin", none)
    expect(page.rows.map((row) => row.action)).toEqual([
      "report.submit",
      "issue.refer",
      "report.reject",
    ])
    expect(page.rows[2]).toMatchObject({
      entityType: "report",
      entityCode: "AUA-26-AAAAA",
      actorRole: "admin",
      changedColumns: ["status"],
      reasonCode: "standard_2",
    })
    expect(page.rows[0]?.actorRole).toBeNull()
    // Unknown issue id: code missing
    expect(page.rows[1]?.entityCode).toBeNull()
    expect(page.next).toBeNull()
  })

  test("filters by action, data type and Jakarta days", async () => {
    const rejects = await listAudit(orgA, "admin", {
      ...none,
      action: "report.reject",
    })
    expect(rejects.rows).toHaveLength(1)
    const issuesOnly = await listAudit(orgA, "admin", {
      ...none,
      entity: "issue",
    })
    expect(issuesOnly.rows.map((row) => row.action)).toEqual(["issue.refer"])
    const window = await listAudit(orgA, "admin", {
      ...none,
      from: "2026-10-11",
      to: "2026-10-12",
    })
    expect(window.rows.map((row) => row.action)).toEqual(["issue.refer"])
  })

  test("pages with a keyset cursor", async () => {
    for (let i = 0; i < AUDIT_PAGE_SIZE; i++) {
      await audit(orgB, "issue.close", `2026-09-01T0${i % 10}:00:00Z`)
    }
    const first = await listAudit(orgB, "admin", none)
    expect(first.rows).toHaveLength(AUDIT_PAGE_SIZE)
    expect(first.next).not.toBeNull()
    const query = parseAuditQuery(
      new URLSearchParams(`sebelum=${first.next ?? ""}`),
    )
    const second = await listAudit(orgB, "admin", query)
    expect(second.rows).toHaveLength(1)
    expect(second.next).toBeNull()
    const last = first.rows.at(-1)
    if (!last) throw new Error("no rows")
    expect(encodeAuditCursor(last)).toBe(first.next ?? "")
  })
})
