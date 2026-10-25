import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { database } from "../../../db/client.server.ts"
import { migrate } from "../../../db/migrate.ts"
import {
  type EvidenceStatus,
  evidence,
  reports,
} from "../../../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../../../db/testing.ts"
import { derivedPath, originalPath } from "../../../server/files.server.ts"
import { BOX_SCALE } from "../../../shared/evidence.ts"
import { runPublish } from "../issues/publish.server.ts"
import {
  decideEvidence,
  getEvidenceEditor,
  originalResponse,
  readOriginal,
  readPreview,
} from "./evidence.server.ts"
import { runMerge } from "./merge.server.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
let orgA = ""
let orgB = ""
let reportId = ""
let filesDir = ""
let moderator = ""
let reporter = ""
const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])

async function seedEvidence(status: EvidenceStatus): Promise<string> {
  const [row] = await suDb
    .insert(evidence)
    .values({
      orgId: orgA,
      reportId,
      position: Math.floor(Math.random() * 5),
      kind: "image",
      declaredName: "foto.jpg",
      declaredType: "image/jpeg",
      declaredSize: 1000,
      status,
      previewPages: 1,
    })
    .returning({ id: evidence.id })
  if (!row) throw new Error("evidence not inserted")
  const path = derivedPath(filesDir, orgA, row.id)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, BYTES)
  return row.id
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "itb")
  orgB = await insertOrg(su, "ugm")
  const user = await insertUser(su, "pelapor.evidence@contoh.id")
  reporter = user
  moderator = await insertUser(su, "moderator.evidence@contoh.id")
  const [report] = await suDb
    .insert(reports)
    .values(reportValues(orgA, user))
    .returning({ id: reports.id })
  reportId = report?.id ?? ""
  filesDir = await mkdtemp(`${tmpdir()}/sb-preview-`)
  await database().boss.start()
})

afterAll(async () => {
  await rm(filesDir, { recursive: true, force: true })
  await resetData(su)
  await su.end()
})

describe("readPreview", () => {
  test("serves the derived copy of a ready file", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedEvidence("ready")
    const file = await readPreview(orgA, "admin", id, filesDir)
    expect(
      new Uint8Array(await (file?.arrayBuffer() ?? new ArrayBuffer(0))),
    ).toEqual(BYTES)
  })

  test("a file without a processed copy is not served", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedEvidence("received")
    expect(await readPreview(orgA, "admin", id, filesDir)).toBeNull()
  })

  test("another tenant cannot read the preview", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedEvidence("ready")
    expect(await readPreview(orgB, "admin", id, filesDir)).toBeNull()
  })

  test("a ready row with no file on disk is not served", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedEvidence("ready")
    await rm(derivedPath(filesDir, orgA, id))
    expect(await readPreview(orgA, "admin", id, filesDir)).toBeNull()
  })
})

type Seed = {
  kind?: "image" | "pdf" | "video"
  status?: EvidenceStatus
  pages?: number
  report?: string
  position?: number
}

async function seedFile(seed: Seed = {}): Promise<string> {
  const kind = seed.kind ?? "image"
  const [row] = await suDb
    .insert(evidence)
    .values({
      orgId: orgA,
      reportId: seed.report ?? reportId,
      position: seed.position ?? 0,
      kind,
      declaredName: kind === "pdf" ? "surat.pdf" : "foto.jpg",
      declaredType: kind === "pdf" ? "application/pdf" : "image/jpeg",
      declaredSize: 1000,
      status: seed.status ?? "ready",
      detectedType: kind === "pdf" ? "application/pdf" : "image/jpeg",
      previewPages: seed.pages ?? 1,
    })
    .returning({ id: evidence.id })
  if (!row) throw new Error("evidence not inserted")
  return row.id
}

async function freshReport(): Promise<string> {
  const [report] = await suDb
    .insert(reports)
    .values(reportValues(orgA, reporter, { status: "verified" }))
    .returning({ id: reports.id })
  return report?.id ?? ""
}

const BOX = {
  page: 0,
  x: 0,
  y: 0,
  w: BOX_SCALE / 4,
  h: BOX_SCALE / 4,
  style: "fill" as const,
}

async function publishJobs(id: string): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'evidence-publish' AND data->>'evidenceId' = $1",
    [id],
  )
  return rows[0]?.n ?? 0
}

describe("readPreview pages", () => {
  test("serves PDF pages and the video file", async () => {
    await su.query("DELETE FROM evidence")
    const pdf = await seedFile({ kind: "pdf", pages: 2 })
    const page = derivedPath(filesDir, orgA, pdf, "1.webp")
    await mkdir(dirname(page), { recursive: true })
    await writeFile(page, BYTES)
    expect(
      await readPreview(orgA, "admin", pdf, filesDir, "1.webp"),
    ).not.toBeNull()
    // Past the rendered pages
    expect(await readPreview(orgA, "admin", pdf, filesDir, "2.webp")).toBeNull()
    expect(
      await readPreview(orgA, "admin", pdf, filesDir, "video.mp4"),
    ).toBeNull()
  })
})

describe("decideEvidence", () => {
  test("saves boxes and audits, no job before merge", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedFile()
    const result = await decideEvidence(orgA, {
      evidenceId: id,
      actorId: moderator,
      seen: null,
      input: { decision: "redact", boxes: [BOX] },
    })
    expect(result).toEqual({ ok: true, queued: false })
    const { rows } = await su.query(
      "SELECT decision, redaction_boxes, publish_pages, decided_by FROM evidence WHERE id = $1",
      [id],
    )
    expect(rows[0]).toEqual({
      decision: "redact",
      redaction_boxes: [BOX],
      publish_pages: [0],
      decided_by: moderator,
    })
    const audit = await su.query(
      "SELECT action, entity_type, changed_columns, reason_code FROM audit_log WHERE entity_id = $1",
      [id],
    )
    expect(audit.rows).toEqual([
      {
        action: "evidence.decide",
        entity_type: "evidence",
        changed_columns: ["decision", "redaction_boxes", "publish_pages"],
        reason_code: "redact",
      },
    ])
    expect(await publishJobs(id)).toBe(0)
  })

  test("a stale form is a conflict", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedFile()
    const input = { decision: "no_redaction" }
    expect(
      await decideEvidence(orgA, {
        evidenceId: id,
        actorId: moderator,
        seen: null,
        input,
      }),
    ).toEqual({ ok: true, queued: false })
    expect(
      await decideEvidence(orgA, {
        evidenceId: id,
        actorId: moderator,
        seen: null,
        input,
      }),
    ).toEqual({ ok: false, reason: "changed" })
  })

  test("invalid choices are refused", async () => {
    await su.query("DELETE FROM evidence")
    const video = await seedFile({ kind: "video" })
    expect(
      await decideEvidence(orgA, {
        evidenceId: video,
        actorId: moderator,
        seen: null,
        input: { decision: "redact", boxes: [BOX] },
      }),
    ).toEqual({ ok: false, reason: "video_no_boxes" })
  })

  test("a published or unprocessed file is locked", async () => {
    await su.query("DELETE FROM evidence")
    for (const status of ["received", "rejected_malware"] as const) {
      const id = await seedFile({ status })
      expect(
        await decideEvidence(orgA, {
          evidenceId: id,
          actorId: moderator,
          seen: null,
          input: { decision: "no_redaction" },
        }),
      ).toEqual({ ok: false, reason: "not_ready" })
      await su.query("DELETE FROM evidence WHERE id = $1", [id])
    }
  })

  test("another campus cannot decide", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedFile()
    expect(
      await decideEvidence(orgB, {
        evidenceId: id,
        actorId: moderator,
        seen: null,
        input: { decision: "no_redaction" },
      }),
    ).toEqual({ ok: false, reason: "not_found" })
  })

  test("approval publishes once the issue is public", async () => {
    const report = await freshReport()
    const early = await seedFile({ report })
    await decideEvidence(orgA, {
      evidenceId: early,
      actorId: moderator,
      seen: null,
      input: { decision: "no_redaction" },
    })
    const merged = await runMerge(orgA, {
      reportIds: [report],
      target: {
        kind: "new",
        title: "Jalan berlubang di Dago",
        summary: "Beberapa warga melaporkan lubang besar di jalan.",
      },
      actorId: moderator,
      now: new Date(),
      notify: false,
    })
    if (!merged.ok) throw new Error(merged.reason)
    expect(await publishJobs(early)).toBe(0)
    await runPublish(
      { id: orgA, host: "itb.localhost" },
      { issueId: merged.issueId, actorId: moderator },
      {
        purge: {
          purgeUrls: async () => ({ skipped: true }),
          purgeHosts: async () => ({ skipped: true }),
        },
      },
    )
    expect(await publishJobs(early)).toBe(1)
    // Later decisions publish at once
    const late = await seedFile({ report, position: 1 })
    expect(
      await decideEvidence(orgA, {
        evidenceId: late,
        actorId: moderator,
        seen: null,
        input: { decision: "redact", boxes: [BOX] },
      }),
    ).toEqual({ ok: true, queued: true })
    expect(await publishJobs(late)).toBe(1)
    // Withheld never queues
    const third = await seedFile({ report, position: 2 })
    expect(
      await decideEvidence(orgA, {
        evidenceId: third,
        actorId: moderator,
        seen: null,
        input: { decision: "withhold" },
      }),
    ).toEqual({ ok: true, queued: false })
  })
})

describe("getEvidenceEditor", () => {
  test("Given an undecided file of a report in no issue, when opened, then no lock token and no issue", async () => {
    const report = await freshReport()
    const id = await seedFile({ report })
    const editor = await getEvidenceEditor(orgA, "admin", id)
    expect(editor).toMatchObject({
      id,
      kind: "image",
      status: "ready",
      decision: null,
      seen: null,
      issue: null,
    })
    expect(editor).not.toHaveProperty("reportId")
  })

  test("Given a decided file of a public issue, when opened, then its decision, lock token and issue", async () => {
    const report = await freshReport()
    const id = await seedFile({ report })
    await decideEvidence(orgA, {
      evidenceId: id,
      actorId: moderator,
      seen: null,
      input: { decision: "redact", boxes: [BOX] },
    })
    const merged = await runMerge(orgA, {
      reportIds: [report],
      target: {
        kind: "new",
        title: "Jalan berlubang di Coblong",
        summary: "Beberapa warga melaporkan lubang besar di jalan.",
      },
      actorId: moderator,
      now: new Date(),
      notify: false,
    })
    if (!merged.ok) throw new Error(merged.reason)
    const before = await getEvidenceEditor(orgA, "admin", id)
    expect(before?.issue).toEqual({ code: merged.code, published: false })
    await su.query("UPDATE issues SET published_at = now() WHERE id = $1", [
      merged.issueId,
    ])
    const editor = await getEvidenceEditor(orgA, "admin", id)
    const { rows } = await su.query<{ decided_at: Date }>(
      "SELECT decided_at FROM evidence WHERE id = $1",
      [id],
    )
    expect(editor).toMatchObject({
      decision: "redact",
      boxes: [BOX],
      seen: rows[0]?.decided_at.toISOString(),
      issue: { code: merged.code, published: true },
    })
    // Token round-trips into a decision
    expect(
      await decideEvidence(orgA, {
        evidenceId: id,
        actorId: moderator,
        seen: editor?.seen ?? null,
        input: { decision: "no_redaction" },
      }),
    ).toMatchObject({ ok: true })
  })

  test("Given another campus, when it opens the file, then nothing", async () => {
    const id = await seedFile({ report: await freshReport() })
    expect(await getEvidenceEditor(orgB, "admin", id)).toBeNull()
  })
})

describe("readOriginal", () => {
  test("an unscanned or unchecked original is never served", async () => {
    await su.query("DELETE FROM evidence")
    const read = (evidenceId: string) =>
      readOriginal(orgA, {
        role: "admin",
        actorId: moderator,
        evidenceId,
        filesDir,
      })
    const cases: [Seed, string | null, boolean][] = [
      [{ kind: "pdf", status: "received" }, null, false],
      [
        { kind: "pdf", status: "needs_manual_review" },
        "unsupported_type",
        false,
      ],
      [{ kind: "pdf", status: "ready" }, null, false],
      [{ kind: "image", status: "received" }, null, false],
      [
        { kind: "image", status: "needs_manual_review" },
        "unsupported_type",
        false,
      ],
      // ASVS V5.4.3: every kind scanned
      [{ kind: "image", status: "ready" }, null, false],
      [
        { kind: "video", status: "needs_manual_review" },
        "video_too_long",
        false,
      ],
    ]
    for (const [index, [seed, failure, served]] of cases.entries()) {
      const id = await seedFile({
        ...seed,
        position: index % 5,
        report: await freshReport(),
      })
      await su.query("UPDATE evidence SET failure_reason = $2 WHERE id = $1", [
        id,
        failure,
      ])
      const path = originalPath(filesDir, orgA, id)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, BYTES)
      expect([seed, Boolean(await read(id))]).toEqual([seed, served])
      if (!served) {
        await su.query("UPDATE evidence SET scanned_at = now() WHERE id = $1", [
          id,
        ])
        expect([seed, Boolean(await read(id))]).toEqual([seed, true])
      }
    }
  })

  test("logs every download and refuses malware", async () => {
    await su.query("DELETE FROM evidence")
    const id = await seedFile()
    await su.query("UPDATE evidence SET scanned_at = now() WHERE id = $1", [id])
    const path = originalPath(filesDir, orgA, id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, BYTES)
    const file = await readOriginal(orgA, {
      role: "admin",
      actorId: moderator,
      evidenceId: id,
      filesDir,
    })
    expect(file?.name).toBe("foto.jpg")
    // Reporter's extension never reaches staff
    await su.query(
      "UPDATE evidence SET declared_name = 'Surat_Resmi.hta' WHERE id = $1",
      [id],
    )
    const renamed = await readOriginal(orgA, {
      role: "admin",
      actorId: moderator,
      evidenceId: id,
      filesDir,
    })
    expect(renamed?.name).toBe("Surat_Resmi.jpg")
    const audit = await su.query(
      "SELECT action FROM audit_log WHERE entity_id = $1",
      [id],
    )
    expect(audit.rows).toEqual([
      { action: "evidence.download_original" },
      { action: "evidence.download_original" },
    ])
    await su.query(
      "UPDATE evidence SET status = 'rejected_malware' WHERE id = $1",
      [id],
    )
    expect(
      await readOriginal(orgA, {
        role: "admin",
        actorId: moderator,
        evidenceId: id,
        filesDir,
      }),
    ).toBeNull()
  })
})

describe("originalResponse", () => {
  // Download only, never rendered
  test("an attachment the browser never renders", async () => {
    const res = originalResponse(new Blob(["x"]), "Surat Résmi.jpg")
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/octet-stream",
      "content-disposition":
        "attachment; filename=\"Surat R_smi.jpg\"; filename*=UTF-8''Surat%20R%C3%A9smi.jpg",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "sandbox; default-src 'none'; frame-ancestors 'none'",
    })
    expect(await res.text()).toBe("x")
  })
})
