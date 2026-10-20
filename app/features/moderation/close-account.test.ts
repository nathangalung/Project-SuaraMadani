import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "../../../db/migrate.ts"
import { evidence, reports } from "../../../db/schema/reports.ts"
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
  derivedPath,
  originalPath,
  publicMediaPath,
} from "../../../server/files.server.ts"
import type { PurgeClient } from "../../../server/purge.server.ts"
import { createTakedownHandler } from "../../../worker/takedown.ts"
import { runPublish } from "../issues/publish.server.ts"
import { type CloseAccountInput, closeAccount } from "./close-account.server.ts"
import { runMerge } from "./merge.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const NOW = new Date("2026-10-13T03:00:00Z")
let orgA = ""
let orgB = ""
let minor = ""
let other = ""
let moderator = ""
let filesDir = ""

function recorder(hosts: string[][]): PurgeClient {
  return {
    purgeUrls: async () => ({ skipped: true }),
    purgeHosts: async (list) => {
      hosts.push(list)
      return { skipped: false }
    },
  }
}

async function report(org: string, user: string) {
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(org, user, { status: "verified", verifiedAt: NOW }))
    .returning({ id: reports.id })
  if (!row) throw new Error("no report")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'reporter') ON CONFLICT DO NOTHING",
    [org, user],
  )
  return row.id
}

async function withFile(org: string, reportId: string) {
  const [row] = await suDb
    .insert(evidence)
    .values({
      orgId: org,
      reportId,
      position: 0,
      kind: "image",
      declaredName: "foto.jpg",
      declaredType: "image/jpeg",
      declaredSize: 4,
      status: "ready",
    })
    .returning({ id: evidence.id })
  if (!row) throw new Error("no evidence")
  for (const path of [
    originalPath(filesDir, org, row.id),
    derivedPath(filesDir, org, row.id),
  ]) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, new Uint8Array([1, 2, 3, 4]))
  }
  return row.id
}

async function publishedIssue(reportIds: string[]) {
  const merged = await runMerge(orgA, {
    reportIds,
    target: {
      kind: "new",
      title: "Atap sekolah runtuh di Coblong",
      summary: "Beberapa laporan menyebut atap ruang kelas runtuh.",
    },
    actorId: moderator,
    campusCode: "ITB",
    now: NOW,
  })
  if (!merged.ok) throw new Error(merged.reason)
  await runPublish(
    { id: orgA, host: "itb.localhost" },
    { issueId: merged.issueId, actorId: moderator, notify: false },
    {
      purge: {
        purgeUrls: async () => ({ skipped: true }),
        purgeHosts: async () => ({ skipped: true }),
      },
    },
  )
  return merged
}

// Worker side, after commit
async function runTakedowns(org: string, hosts: string[][]) {
  const { rows } = await su.query<{ id: string; action: string }>(
    "SELECT id, action FROM takedowns WHERE org_id = $1 AND purge_status <> 'done'",
    [org],
  )
  const handle = createTakedownHandler({
    filesDir,
    purge: recorder(hosts),
    mediaHost: null,
    deleteVideo: async () => {},
    requirePurge: false,
  })
  for (const row of rows) {
    expect(row.action).toBe("remove_on_request")
    await handle({ orgId: org, takedownId: row.id })
  }
  return rows.length
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  )
}

function input(reportId: string, org = orgA): CloseAccountInput {
  return {
    tenant: { id: org, host: org === orgA ? "itb.localhost" : "ugm.localhost" },
    reportId,
    reason: "self_declared",
    actorId: moderator,
  }
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  moderator = await insertUser(su, "moderator.close@contoh.id")
  await su.query(
    "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
    [orgA, moderator],
  )
  filesDir = await mkdtemp(`${tmpdir()}/sm-close-`)
})

beforeEach(async () => {
  await su.query("DELETE FROM issue_reports")
  await su.query("DELETE FROM issues")
  await su.query("DELETE FROM org_counters")
  await su.query("DELETE FROM reports")
  await su.query("DELETE FROM takedowns")
  await su.query(
    "DELETE FROM users WHERE email LIKE 'anak.%' OR email LIKE 'lain.%'",
  )
  minor = await insertUser(su, `anak.${crypto.randomUUID()}@contoh.id`)
  other = await insertUser(su, `lain.${crypto.randomUUID()}@contoh.id`)
  await su.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    [crypto.randomUUID(), minor],
  )
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("closeAccount", () => {
  test("removes the account's data at this campus only", async () => {
    const shared = await report(orgA, minor)
    const alone = await report(orgA, minor)
    const kept = await report(orgA, other)
    const atB = await report(orgB, minor)
    const file = await withFile(orgA, alone)
    const fileB = await withFile(orgB, atB)
    const mixed = await publishedIssue([shared, kept])
    const solo = await publishedIssue([alone])
    await su.query(
      "INSERT INTO follows (org_id, issue_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [orgA, mixed.issueId, minor],
    )
    const { rows: demand } = await su.query<{ id: string }>(
      `INSERT INTO demands (org_id, year, number, public_code, scope, title,
         body, summary, target, raised_on, state, published_at)
       VALUES ($1, 2026, 99, 'TUN-CLA-26-0099', 'national', 'Judul', 'Teks.',
         'Ringkasan.', 'Kementerian', '2026-09-01', 'published', now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgA],
    )
    await su.query(
      "INSERT INTO demand_follows (org_id, demand_id, user_id) VALUES ($1, $2, $3)",
      [orgA, demand[0]?.id, minor],
    )
    await su.query(
      "INSERT INTO demand_ratings (org_id, demand_id, user_id, score, show_name) VALUES ($1, $2, $3, 5, true)",
      [orgA, demand[0]?.id, minor],
    )
    const hosts: string[][] = []

    const result = await closeAccount(input(shared))
    // Files wait for the job
    expect(await exists(originalPath(filesDir, orgA, file))).toBe(true)
    expect(await runTakedowns(orgA, hosts)).toBe(1)

    expect(result).toEqual({
      ok: true,
      reports: 2,
      issues: [mixed.code, solo.code].sort(),
      unpublished: [solo.code],
    })
    const { rows: left } = await su.query(
      "SELECT org_id FROM reports WHERE user_id = $1",
      [minor],
    )
    expect(left).toEqual([{ org_id: orgB }])
    const { rows: membership } = await su.query(
      "SELECT organization_id FROM members WHERE user_id = $1",
      [minor],
    )
    expect(membership).toEqual([{ organization_id: orgB }])
    const sessions = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = $1",
      [minor],
    )
    expect(sessions.rows).toHaveLength(0)
    const follows = await su.query("SELECT 1 FROM follows WHERE user_id = $1", [
      minor,
    ])
    expect(follows.rows).toHaveLength(0)
    const demandFollows = await su.query(
      "SELECT 1 FROM demand_follows WHERE user_id = $1",
      [minor],
    )
    expect(demandFollows.rows).toHaveLength(0)
    const ratings = await su.query(
      "SELECT 1 FROM demand_ratings WHERE user_id = $1",
      [minor],
    )
    expect(ratings.rows).toHaveLength(0)
    const { rows: issues } = await su.query(
      "SELECT public_code, report_count, published_at IS NOT NULL AS published FROM issues ORDER BY public_code",
    )
    expect(issues).toEqual([
      { public_code: mixed.code, report_count: 1, published: true },
      { public_code: solo.code, report_count: 0, published: false },
    ])
    expect(await exists(originalPath(filesDir, orgA, file))).toBe(false)
    expect(await exists(dirname(derivedPath(filesDir, orgA, file)))).toBe(false)
    expect(await exists(originalPath(filesDir, orgB, fileB))).toBe(true)
    expect(hosts).toEqual([["itb.localhost"]])
    const { rows: audit } = await su.query(
      "SELECT action, entity_type, reason_code FROM audit_log WHERE entity_id = $1",
      [minor],
    )
    expect(audit).toEqual([
      {
        action: "account.close_minor",
        entity_type: "user",
        reason_code: "self_declared",
      },
    ])
  })

  test("published copies leave the public folder", async () => {
    const own = await report(orgA, minor)
    const id = await withFile(orgA, own)
    const name = `${"c".repeat(64)}.webp`
    await su.query(
      `UPDATE evidence SET status = 'published', published_at = now(),
         public_media = $2 WHERE id = $1`,
      [
        id,
        JSON.stringify([
          { type: "image", file: name, page: 0, width: 1, height: 1 },
        ]),
      ],
    )
    const path = publicMediaPath(filesDir, "itb.localhost", name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, new Uint8Array([1]))
    const result = await closeAccount(input(own))
    expect(result.ok).toBe(true)
    await runTakedowns(orgA, [])
    expect(await exists(path)).toBe(false)
  })

  test("a admin of another campus cannot reach the account", async () => {
    const atA = await report(orgA, minor)
    const result = await closeAccount(input(atA, orgB))
    expect(result).toEqual({ ok: false, reason: "not_found" })
    expect(await runTakedowns(orgB, [])).toBe(0)
    const { rows } = await su.query("SELECT 1 FROM reports WHERE id = $1", [
      atA,
    ])
    expect(rows).toHaveLength(1)
    const sessions = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = $1",
      [minor],
    )
    expect(sessions.rows).toHaveLength(1)
  })

  test("staff accounts are refused", async () => {
    const own = await report(orgA, moderator)
    await su.query(
      "UPDATE members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
      [orgA, moderator],
    )
    expect(await closeAccount(input(own))).toEqual({
      ok: false,
      reason: "staff",
    })
  })

  test("staff of another campus are refused", async () => {
    const own = await report(orgA, minor)
    await su.query(
      "INSERT INTO members (organization_id, user_id, role) VALUES ($1, $2, 'admin')",
      [orgB, minor],
    )
    expect(await closeAccount(input(own))).toEqual({
      ok: false,
      reason: "staff",
    })
    const sessions = await su.query(
      "SELECT 1 FROM sessions WHERE user_id = $1",
      [minor],
    )
    expect(sessions.rows).toHaveLength(1)
  })

  test("superadmins are refused", async () => {
    const own = await report(orgA, minor)
    await su.query("UPDATE users SET superadmin = true WHERE id = $1", [minor])
    expect(await closeAccount(input(own))).toEqual({
      ok: false,
      reason: "staff",
    })
  })

  test("an adult's deletion request, its own audit row", async () => {
    const adult = await insertUser(
      su,
      `dewasa-${crypto.randomUUID()}@contoh.id`,
    )
    const own = await report(orgA, adult)
    const result = await closeAccount({
      ...input(own),
      reason: "data_subject_request",
    })
    expect(result).toMatchObject({ ok: true, reports: 1 })
    const { rows } = await su.query(
      "SELECT action, reason_code FROM audit_log WHERE entity_id = $1",
      [adult],
    )
    expect(rows).toEqual([
      { action: "account.close", reason_code: "data_subject_request" },
    ])
  })
})
