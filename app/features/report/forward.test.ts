import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
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
import { originalPath } from "../../../server/files.server.ts"
import type { ReportStatus } from "../../../shared/status.ts"
import { type ForwardInput, forwardReport } from "./forward.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const BYTES = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4])
let orgA = ""
let orgB = ""
let reporter = ""
let moderator = ""
let filesDir = ""

const campusA = () => ({ id: orgA, campusCode: "ITB" })

async function seedReport(
  status: ReportStatus = "in_review",
  kind: "image" | "video" = "image",
) {
  const [row] = await suDb
    .insert(reports)
    .values(reportValues(orgA, reporter, { status }))
    .returning({ id: reports.id })
  if (!row) throw new Error("report not inserted")
  await su.query(
    "INSERT INTO report_contacts (org_id, report_id, phone, method) VALUES ($1, $2, '081200000000', 'whatsapp')",
    [orgA, row.id],
  )
  const [file] = await suDb
    .insert(evidence)
    .values({
      orgId: orgA,
      reportId: row.id,
      position: 0,
      kind,
      declaredName: kind === "video" ? "video.mp4" : "foto.jpg",
      declaredType: kind === "video" ? "video/mp4" : "image/jpeg",
      declaredSize: BYTES.length,
      status: "ready",
      detectedType: kind === "video" ? "video/mp4" : "image/jpeg",
      byteSize: BYTES.length,
      sha256: "ab".repeat(32),
    })
    .returning({ id: evidence.id })
  if (!file) throw new Error("evidence not inserted")
  const path = originalPath(filesDir, orgA, file.id)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, BYTES)
  return { id: row.id, evidenceId: file.id }
}

function input(reportId: string, targetOrgId = orgB): ForwardInput {
  return {
    source: campusA(),
    reportId,
    targetOrgId,
    actorId: moderator,
    filesDir,
    now: new Date("2026-10-15T03:00:00Z"),
  }
}

async function copiesOf(reportId: string) {
  const { rows } = await su.query<{
    id: string
    org_id: string
    status: string
    public_code: string
    user_id: string
    forwarded_from_org_id: string
  }>(
    "SELECT id, org_id, status, public_code, user_id, forwarded_from_org_id FROM reports WHERE forwarded_from_report_id = $1",
    [reportId],
  )
  return rows
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  reporter = await insertUser(su, "pelapor.forward@contoh.id")
  moderator = await insertUser(su, "moderator.forward@contoh.id")
  filesDir = await mkdtemp(`${tmpdir()}/sm-forward-`)
})

beforeEach(async () => {
  await su.query("DELETE FROM reports")
  await su.query("DELETE FROM members")
  await su.query(
    "DELETE FROM pgboss.job WHERE name IN ('evidence', 'evidence-video', 'email-send')",
  )
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("forwardReport", () => {
  test("the copy keeps the known code and files still to upload", async () => {
    const seeded = await seedReport()
    await suDb.insert(evidence).values({
      orgId: orgA,
      reportId: seeded.id,
      position: 1,
      kind: "image",
      declaredName: "belum.jpg",
      declaredType: "image/jpeg",
      declaredSize: 2000,
      status: "awaiting_upload",
    })
    const result = await forwardReport(input(seeded.id))
    if (!result.ok) throw new Error(result.reason)
    const { rows: copy } = await su.query<{ forwarded_from_code: string }>(
      "SELECT r.forwarded_from_code, o.public_code AS original FROM reports r, reports o WHERE r.forwarded_from_report_id = $1 AND o.id = $1",
      [seeded.id],
    )
    expect(copy[0]?.forwarded_from_code).toBe(
      (copy[0] as unknown as { original: string }).original,
    )
    const { rows: files } = await su.query<{ status: string; name: string }>(
      `SELECT e.status, e.declared_name AS name FROM evidence e
       JOIN reports r ON r.id = e.report_id
       WHERE r.forwarded_from_report_id = $1 ORDER BY e.position`,
      [seeded.id],
    )
    expect(files).toEqual([
      { status: "received", name: "foto.jpg" },
      { status: "awaiting_upload", name: "belum.jpg" },
    ])
  })

  test("copies the report to the other campus and closes the original", async () => {
    const seeded = await seedReport()
    const result = await forwardReport(input(seeded.id))
    const [copy] = await copiesOf(seeded.id)
    if (!copy) throw new Error("no copy")
    expect(result).toEqual({ ok: true, code: copy.public_code })
    expect(copy).toMatchObject({
      org_id: orgB,
      status: "in_review",
      user_id: reporter,
      forwarded_from_org_id: orgA,
    })
    expect(copy.public_code).toMatch(/^UGM-26-/)
    const { rows: original } = await su.query(
      "SELECT status, forwarded_to_org_id FROM reports WHERE id = $1",
      [seeded.id],
    )
    expect(original).toEqual([
      { status: "forwarded", forwarded_to_org_id: orgB },
    ])
    // Consent was given to A
    const contacts = await su.query(
      "SELECT 1 FROM report_contacts WHERE report_id = $1",
      [copy.id],
    )
    expect(contacts.rows).toHaveLength(0)
    const member = await su.query(
      "SELECT role FROM members WHERE organization_id = $1 AND user_id = $2",
      [orgB, reporter],
    )
    expect(member.rows).toEqual([{ role: "reporter" }])
  })

  test("evidence is hard-linked and processed again at the other campus", async () => {
    const seeded = await seedReport()
    await forwardReport(input(seeded.id))
    const [copy] = await copiesOf(seeded.id)
    const { rows } = await su.query<{ id: string; status: string }>(
      "SELECT id, status FROM evidence WHERE report_id = $1",
      [copy?.id],
    )
    expect(rows.map((r) => r.status)).toEqual(["received"])
    const copied = originalPath(filesDir, orgB, rows[0]?.id ?? "")
    const source = originalPath(filesDir, orgA, seeded.evidenceId)
    expect((await stat(copied)).ino).toBe((await stat(source)).ino)
    const jobs = await su.query(
      "SELECT data->>'orgId' AS org FROM pgboss.job WHERE name = 'evidence' AND data->>'evidenceId' = $1",
      [rows[0]?.id],
    )
    expect(jobs.rows).toEqual([{ org: orgB }])
  })

  test("a forwarded video goes to the video queue", async () => {
    const seeded = await seedReport("in_review", "video")
    await forwardReport(input(seeded.id))
    const [copy] = await copiesOf(seeded.id)
    const { rows } = await su.query<{ id: string }>(
      "SELECT id FROM evidence WHERE report_id = $1",
      [copy?.id],
    )
    const jobs = await su.query(
      "SELECT name FROM pgboss.job WHERE data->>'evidenceId' = $1",
      [rows[0]?.id],
    )
    expect(jobs.rows).toEqual([{ name: "evidence-video" }])
  })

  test("audit rows at both campuses, one email under the new campus", async () => {
    const seeded = await seedReport()
    await forwardReport(input(seeded.id))
    const [copy] = await copiesOf(seeded.id)
    const { rows: audit } = await su.query(
      "SELECT org_id, action, entity_id FROM audit_log WHERE entity_id IN ($1, $2) ORDER BY org_id = $3 DESC",
      [seeded.id, copy?.id, orgA],
    )
    expect(audit).toEqual([
      { org_id: orgA, action: "report.forward", entity_id: seeded.id },
      { org_id: orgB, action: "report.forward_in", entity_id: copy?.id },
    ])
    const { rows: mail } = await su.query(
      "SELECT org_id, report_id, template FROM notifications",
    )
    expect(mail).toEqual([
      { org_id: orgB, report_id: copy?.id, template: "report_forwarded" },
    ])
  })

  test("running it twice keeps one copy and one email", async () => {
    const seeded = await seedReport()
    const first = await forwardReport(input(seeded.id))
    const second = await forwardReport(input(seeded.id))
    expect(second).toEqual(first)
    expect(await copiesOf(seeded.id)).toHaveLength(1)
    const mail = await su.query("SELECT 1 FROM notifications")
    expect(mail.rows).toHaveLength(1)
  })

  test("concurrent forwards keep one copy", async () => {
    const seeded = await seedReport()
    const results = await Promise.all([
      forwardReport(input(seeded.id)),
      forwardReport(input(seeded.id)),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(await copiesOf(seeded.id)).toHaveLength(1)
  })

  test("a admin of the other campus cannot forward it", async () => {
    const seeded = await seedReport()
    const result = await forwardReport({
      ...input(seeded.id, orgA),
      source: { id: orgB, campusCode: "UGM" },
    })
    expect(result).toEqual({ ok: false, reason: "not_found" })
    expect(await copiesOf(seeded.id)).toEqual([])
  })

  test("the own campus is not a target", async () => {
    const seeded = await seedReport()
    expect(await forwardReport(input(seeded.id, orgA))).toEqual({
      ok: false,
      reason: "same_campus",
    })
  })

  test("a decided report cannot be forwarded", async () => {
    const seeded = await seedReport("verified")
    expect(await forwardReport(input(seeded.id))).toEqual({
      ok: false,
      reason: "not_allowed",
    })
    expect(await copiesOf(seeded.id)).toEqual([])
  })
})
