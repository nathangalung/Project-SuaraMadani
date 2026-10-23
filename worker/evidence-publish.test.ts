import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import sharp from "sharp"
import { schema } from "../db/client.server.ts"
import { migrate } from "../db/migrate.ts"
import { reports } from "../db/schema/reports.ts"
import {
  insertOrg,
  insertRegions,
  insertUser,
  reportValues,
  resetData,
  superuserPool,
  testUrl,
} from "../db/testing.ts"
import { derivedPath, publicMediaPath } from "../server/files.server.ts"
import { BOX_SCALE } from "../shared/evidence.ts"
import { createPublishHandler } from "./evidence-publish.ts"
import { pngFixture } from "./fixtures.ts"
import { localStore, r2Store } from "./media-store.ts"

const su = superuserPool()
const mediaPool = new Pool({
  connectionString: testUrl("TEST_DATABASE_SUPERUSER_URL"),
  max: 2,
  options: "-c role=sm_media",
})
const mediaDb = drizzle({ client: mediaPool, schema })

let filesDir = ""
let orgA = ""
let orgB = ""
let userA = ""
let published = ""
let draft = ""
let issueNumber = 0
const HOST = "wpa.localhost"

async function addIssue(orgId: string, isPublished: boolean) {
  issueNumber++
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO issues (org_id, year, number, public_code, title, summary,
       category_id, subcategory_id, province_code, regency_code,
       gov_status, advocacy_status, report_count, published_at)
     VALUES ($1, 2026, $2, $3, 'Atap sekolah runtuh', 'Ringkasan.',
       'program', 'program.pendidikan', '32', '32.73', 'awaiting_response',
       'monitoring', 1, $4) RETURNING id`,
    [
      orgId,
      issueNumber,
      `ISU-2026-10-${String(issueNumber).padStart(4, "0")}`,
      isPublished ? new Date() : null,
    ],
  )
  return rows[0]?.id ?? ""
}

type Setup = {
  kind?: "image" | "pdf" | "video"
  pages?: number
  issueId?: string
  decision?: "redact" | "no_redaction" | "withhold" | null
  boxes?: unknown[]
  publishPages?: number[]
}

async function addReady(setup: Setup = {}): Promise<string> {
  const kind = setup.kind ?? "image"
  const [report] = await drizzle({ client: su })
    .insert(reports)
    .values(reportValues(orgA, userA, { status: "merged" }))
    .returning({ id: reports.id })
  await su.query(
    "INSERT INTO issue_reports (org_id, issue_id, report_id) VALUES ($1, $2, $3)",
    [orgA, setup.issueId ?? published, report?.id],
  )
  const decided = setup.decision === undefined ? "no_redaction" : setup.decision
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
       declared_type, declared_size, status, preview_pages, decision,
       redaction_boxes, publish_pages, decided_at)
     VALUES ($1, $2, 0, $3, 'f', 'x', 1, 'ready', $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      orgA,
      report?.id,
      kind,
      setup.pages ?? 1,
      decided,
      JSON.stringify(setup.boxes ?? []),
      setup.publishPages ?? (kind === "video" ? [] : [0]),
      decided ? new Date() : null,
    ],
  )
  const id = rows[0]?.id ?? ""
  for (let page = 0; page < (setup.pages ?? 1); page++) {
    await Bun.write(
      derivedPath(filesDir, orgA, id, `${page}.webp`),
      await sharp(await pngFixture(200, 120))
        .webp()
        .toBuffer(),
    )
  }
  if (kind === "video") {
    await Bun.write(
      derivedPath(filesDir, orgA, id, "video.mp4"),
      new TextEncoder().encode("not really mp4 but bytes"),
    )
  }
  return id
}

async function state(id: string) {
  const { rows } = await su.query<{
    status: string
    public_media: Record<string, unknown>[] | null
    published_at: Date | null
  }>("SELECT status, public_media, published_at FROM evidence WHERE id = $1", [
    id,
  ])
  return rows[0]
}

function handler(store = localStore(() => filesDir)) {
  return createPublishHandler({ filesDir, db: mediaDb, store })
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "wpa")
  orgB = await insertOrg(su, "wpb")
  userA = await insertUser(su, "publish@suaramadani.test")
  filesDir = await mkdtemp(join(tmpdir(), "sm-publish-"))
  published = await addIssue(orgA, true)
  draft = await addIssue(orgA, false)
})

afterAll(async () => {
  await resetData(su)
  await su.end()
  await mediaPool.end()
  await rm(filesDir, { recursive: true, force: true })
})

describe("evidence-publish", () => {
  test("burns boxes into a hashed public copy", async () => {
    const id = await addReady({
      decision: "redact",
      boxes: [
        {
          page: 0,
          x: 0,
          y: 0,
          w: BOX_SCALE / 2,
          h: BOX_SCALE / 2,
          style: "fill",
        },
      ],
    })
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("published")
    const row = await state(id)
    expect(row?.status).toBe("published")
    expect(row?.published_at).not.toBeNull()
    const [media] = row?.public_media ?? []
    expect(media).toMatchObject({
      type: "image",
      page: 0,
      width: 200,
      height: 120,
    })
    const name = String(media?.file)
    const bytes = await Bun.file(publicMediaPath(filesDir, HOST, name)).bytes()
    // Hash binds the row too
    expect(name).toBe(
      `${createHash("sha256").update(id).update(bytes).digest("hex")}.webp`,
    )
    const { data } = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true })
    // Box centre is black
    const i = (30 * 200 + 50) * 3
    expect(Math.max(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)).toBe(0)
  })

  test("identical copies of two rows never share a file", async () => {
    const run = handler()
    const first = await addReady()
    const second = await addReady()
    await run({ orgId: orgA, evidenceId: first })
    await run({ orgId: orgA, evidenceId: second })
    const [a] = (await state(first))?.public_media ?? []
    const [b] = (await state(second))?.public_media ?? []
    expect(a?.file).not.toBe(b?.file)
  })

  test("publishes only the chosen PDF pages", async () => {
    const id = await addReady({ kind: "pdf", pages: 3, publishPages: [0, 2] })
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("published")
    const media = (await state(id))?.public_media ?? []
    expect(media.map((m) => m.page)).toEqual([0, 2])
  })

  test("withheld and undecided files stay private", async () => {
    for (const decision of ["withhold", null] as const) {
      const id = await addReady({ decision })
      expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("skipped")
      expect(await state(id)).toMatchObject({
        status: "ready",
        public_media: null,
      })
    }
  })

  test("an unpublished issue publishes nothing", async () => {
    const id = await addReady({ issueId: draft })
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("skipped")
    expect((await state(id))?.status).toBe("ready")
  })

  test("a second run is a no-op", async () => {
    const id = await addReady()
    const run = handler()
    expect(await run({ orgId: orgA, evidenceId: id })).toBe("published")
    const before = (await state(id))?.published_at
    expect(await run({ orgId: orgA, evidenceId: id })).toBe("skipped")
    expect((await state(id))?.published_at).toEqual(before ?? null)
  })

  test("video goes to the store with a poster", async () => {
    const id = await addReady({ kind: "video" })
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("published")
    const [media] = (await state(id))?.public_media ?? []
    expect(media).toMatchObject({ type: "video", store: "local" })
    expect(
      await Bun.file(
        publicMediaPath(filesDir, HOST, String(media?.file)),
      ).exists(),
    ).toBe(true)
    expect(
      await Bun.file(
        publicMediaPath(filesDir, HOST, String(media?.poster)),
      ).exists(),
    ).toBe(true)
  })

  test("R2 store receives a signed PUT", async () => {
    const seen: { method: string; path: string; type: string | null }[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        await request.arrayBuffer()
        seen.push({
          method: request.method,
          path: new URL(request.url).pathname,
          type: request.headers.get("content-type"),
        })
        return new Response(null, {
          status: 200,
          headers: { etag: '"x"' },
        })
      },
    })
    try {
      const store = r2Store({
        endpoint: server.url.origin,
        bucket: "media",
        accessKeyId: "test",
        secretAccessKey: "test-secret",
      })
      const id = await addReady({ kind: "video" })
      expect(await handler(store)({ orgId: orgA, evidenceId: id })).toBe(
        "published",
      )
      const [media] = (await state(id))?.public_media ?? []
      expect(media).toMatchObject({ type: "video", store: "r2" })
      const put = seen.find((s) => s.method === "PUT")
      expect(put?.path).toBe(`/media/${HOST}/${String(media?.file)}`)
      expect(put?.type).toBe("video/mp4")
    } finally {
      server.stop(true)
    }
  })

  test("an issue hidden mid-publish keeps no public copy", async () => {
    const issueId = await addIssue(orgA, true)
    const id = await addReady({ kind: "video", issueId })
    const mediaDir = join(filesDir, "public", HOST, "media")
    const before = (await readdir(mediaDir).catch(() => [])).sort()
    const local = localStore(() => filesDir)
    const written: string[] = []
    const store = {
      ...local,
      putVideo: async (host: string, name: string, bytes: Uint8Array) => {
        await local.putVideo(host, name, bytes)
        written.push(name)
        // Admin hides it now
        await su.query("UPDATE issues SET published_at = NULL WHERE id = $1", [
          issueId,
        ])
      },
    }
    expect(await handler(store)({ orgId: orgA, evidenceId: id })).toBe(
      "skipped",
    )
    expect((await state(id))?.status).toBe("ready")
    expect(written).toHaveLength(1)
    expect(
      await Bun.file(
        publicMediaPath(filesDir, HOST, written[0] ?? ""),
      ).exists(),
    ).toBe(false)
    // Poster removed too
    expect((await readdir(mediaDir)).sort()).toEqual(before)
  })

  test("a decision changed mid-publish keeps no public copy", async () => {
    const id = await addReady({ kind: "video" })
    const mediaDir = join(filesDir, "public", HOST, "media")
    const before = (await readdir(mediaDir).catch(() => [])).sort()
    const local = localStore(() => filesDir)
    const store = {
      ...local,
      putVideo: async (host: string, name: string, bytes: Uint8Array) => {
        await local.putVideo(host, name, bytes)
        // Admin withholds it now
        await su.query(
          "UPDATE evidence SET decision = 'withhold', decided_at = now() WHERE id = $1",
          [id],
        )
      },
    }
    expect(await handler(store)({ orgId: orgA, evidenceId: id })).toBe(
      "skipped",
    )
    expect((await state(id))?.status).toBe("ready")
    expect((await readdir(mediaDir)).sort()).toEqual(before)
  })

  test("an unchanged decision with microseconds still publishes", async () => {
    const id = await addReady()
    await su.query(
      "UPDATE evidence SET decided_at = '2026-10-13 03:00:00.123456+00' WHERE id = $1",
      [id],
    )
    expect(await handler()({ orgId: orgA, evidenceId: id })).toBe("published")
  })

  test("R2 store deletes by key", async () => {
    const seen: { method: string; path: string }[] = []
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        seen.push({
          method: request.method,
          path: new URL(request.url).pathname,
        })
        return new Response(null, { status: 204 })
      },
    })
    try {
      const store = r2Store({
        endpoint: server.url.origin,
        bucket: "media",
        accessKeyId: "test",
        secretAccessKey: "test-secret",
      })
      const name = `${"d".repeat(64)}.mp4`
      await store.deleteVideo(HOST, name)
      expect(seen).toEqual([
        { method: "DELETE", path: `/media/${HOST}/${name}` },
      ])
    } finally {
      server.stop(true)
    }
  })

  test("a missing or foreign row is skipped", async () => {
    const id = await addReady()
    expect(await handler()({ orgId: orgB, evidenceId: id })).toBe("skipped")
    expect((await state(id))?.status).toBe("ready")
    expect(
      await handler()({ orgId: orgA, evidenceId: crypto.randomUUID() }),
    ).toBe("skipped")
  })

  test("leaves no temp files", async () => {
    const names = await readdir(join(filesDir, "public"), { recursive: true })
    expect(names.filter((name) => name.includes(".tmp-"))).toEqual([])
  })
})
