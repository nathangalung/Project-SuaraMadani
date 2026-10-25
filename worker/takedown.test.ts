import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { drizzle } from "drizzle-orm/node-postgres"
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
import {
  derivedPath,
  originalPath,
  publicMediaPath,
} from "../server/files.server.ts"
import type { PurgeClient } from "../server/purge.server.ts"
import { createTakedownHandler, type TakedownDeps } from "./takedown.ts"

const su = superuserPool()
const suDb = drizzle({ client: su })
const HOST = "tdk.localhost"
const LOCAL = `${"b".repeat(64)}.webp`
const VIDEO = `${"c".repeat(64)}.mp4`
let filesDir = ""
let orgA = ""
let orgB = ""
let purged: string[][] = []
let deleted: string[] = []
let purgeFails = false
let purgeSkips = false

function deps(overrides: Partial<TakedownDeps> = {}): TakedownDeps {
  const purge: PurgeClient = {
    purgeUrls: async () => ({ skipped: true }),
    purgeHosts: async (hosts) => {
      if (purgeFails) throw new Error("purge failed: 429")
      if (purgeSkips) return { skipped: true }
      purged.push(hosts)
      return { skipped: false }
    },
  }
  return {
    filesDir,
    purge,
    mediaHost: "media.contoh.id",
    deleteVideo: async (host, name) => {
      deleted.push(`${host}/${name}`)
    },
    requirePurge: true,
    ...overrides,
  }
}

async function takedown(
  orgId: string,
  values: { evidenceIds?: string[]; status?: string } = {},
): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `INSERT INTO takedowns (org_id, action, public_files, evidence_ids, purge_status, done_at)
     VALUES ($1, 'take_down', $2, $3, $4, $5) RETURNING id`,
    [
      orgId,
      JSON.stringify([
        { file: LOCAL, store: "local" },
        { file: VIDEO, store: "r2" },
      ]),
      values.evidenceIds ?? [],
      values.status ?? "pending",
      values.status === "done" ? new Date() : null,
    ],
  )
  return rows[0]?.id ?? ""
}

async function row(id: string) {
  const { rows } = await su.query(
    "SELECT purge_status, attempts, last_error, done_at IS NOT NULL AS done FROM takedowns WHERE id = $1",
    [id],
  )
  return rows[0]
}

async function touch(path: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "x")
}

const exists = (path: string) => Bun.file(path).exists()

/** Published row still serving files. */
async function liveEvidence(orgId: string, media: unknown[]): Promise<void> {
  const user = await insertUser(su, `tdk-${crypto.randomUUID()}@contoh.test`)
  const [report] = await suDb
    .insert(reports)
    .values(reportValues(orgId, user))
    .returning({ id: reports.id })
  await su.query(
    `INSERT INTO evidence (org_id, report_id, position, kind, declared_name,
       declared_type, declared_size, status, public_media, published_at)
     VALUES ($1, $2, 0, 'video', 'a.mp4', 'video/mp4', 10, 'published', $3, now())`,
    [orgId, report?.id, JSON.stringify(media)],
  )
}

beforeAll(async () => {
  await migrate(testUrl("TEST_DATABASE_MIGRATOR_URL"))
  await resetData(su)
  await insertRegions(su)
  orgA = await insertOrg(su, "tdk")
  orgB = await insertOrg(su, "tdl")
  filesDir = await mkdtemp(`${tmpdir()}/takedown-`)
})

beforeEach(async () => {
  purged = []
  deleted = []
  purgeFails = false
  purgeSkips = false
  await su.query("DELETE FROM takedowns")
  await su.query("DELETE FROM evidence")
})

afterAll(async () => {
  await resetData(su)
  await su.end()
  await rm(filesDir, { recursive: true, force: true })
})

describe("takedown job", () => {
  test("deletes copies, purges both hosts, marks done", async () => {
    const local = publicMediaPath(filesDir, HOST, LOCAL)
    await touch(local)
    const id = await takedown(orgA)
    const handle = createTakedownHandler(deps())
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
    expect(await exists(local)).toBe(false)
    expect(deleted).toEqual([`${HOST}/${VIDEO}`])
    expect(purged).toEqual([[HOST, "media.contoh.id"]])
    expect(await row(id)).toEqual({
      purge_status: "done",
      attempts: 1,
      last_error: null,
      done: true,
    })
  })

  test("a failed purge is recorded and retried", async () => {
    const id = await takedown(orgA)
    purgeFails = true
    const handle = createTakedownHandler(deps())
    await expect(handle({ orgId: orgA, takedownId: id })).rejects.toThrow()
    expect(await row(id)).toEqual({
      purge_status: "retrying",
      attempts: 1,
      last_error: "purge",
      done: false,
    })
    purgeFails = false
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
    expect((await row(id))?.attempts).toBe(2)
  })

  test("a done row is not repeated", async () => {
    const id = await takedown(orgA, { status: "done" })
    const handle = createTakedownHandler(deps())
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("skipped")
    expect(purged).toEqual([])
  })

  test("a wrong org reads nothing and throws", async () => {
    const id = await takedown(orgA)
    const handle = createTakedownHandler(deps())
    await expect(handle({ orgId: orgB, takedownId: id })).rejects.toThrow(
      "takedown not found under tenant",
    )
    expect((await row(id))?.purge_status).toBe("pending")
  })

  test("data-subject removal deletes private files too", async () => {
    const evidenceId = crypto.randomUUID()
    const original = originalPath(filesDir, orgA, evidenceId)
    const preview = derivedPath(filesDir, orgA, evidenceId)
    await touch(original)
    await touch(preview)
    const id = await takedown(orgA, { evidenceIds: [evidenceId] })
    const handle = createTakedownHandler(deps())
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
    expect(await exists(original)).toBe(false)
    expect(await exists(preview)).toBe(false)
  })

  test("no media host purges the campus only", async () => {
    const id = await takedown(orgA)
    const handle = createTakedownHandler(deps({ mediaHost: null }))
    await handle({ orgId: orgA, takedownId: id })
    expect(purged).toEqual([[HOST]])
  })

  test("an unconfigured purge never settles done", async () => {
    const id = await takedown(orgA)
    purgeSkips = true
    const handle = createTakedownHandler(deps())
    await expect(handle({ orgId: orgA, takedownId: id })).rejects.toThrow()
    expect(await row(id)).toEqual({
      purge_status: "retrying",
      attempts: 1,
      last_error: "purge",
      done: false,
    })
  })

  test("outside production a skipped purge finishes", async () => {
    const id = await takedown(orgA)
    purgeSkips = true
    const handle = createTakedownHandler(deps({ requirePurge: false }))
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
  })

  test("republished copies survive a late takedown", async () => {
    const local = publicMediaPath(filesDir, HOST, LOCAL)
    await touch(local)
    await liveEvidence(orgA, [
      {
        type: "video",
        file: VIDEO,
        poster: LOCAL,
        store: "r2",
        width: 1,
        height: 1,
      },
    ])
    const id = await takedown(orgA)
    const handle = createTakedownHandler(deps())
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
    expect(await exists(local)).toBe(true)
    expect(deleted).toEqual([])
    expect(purged).toEqual([[HOST, "media.contoh.id"]])
  })

  test("live copies of another campus do not count", async () => {
    const local = publicMediaPath(filesDir, HOST, LOCAL)
    await touch(local)
    await liveEvidence(orgB, [
      { type: "image", file: LOCAL, page: 0, width: 1, height: 1 },
    ])
    const id = await takedown(orgA)
    const handle = createTakedownHandler(deps())
    expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
    expect(await exists(local)).toBe(false)
  })
})

describe("worker defaults", () => {
  const KEYS = [
    "FILES_DIR",
    "MEDIA_PUBLIC_ORIGIN",
    "CLOUDFLARE_ZONE_ID",
    "CLOUDFLARE_API_TOKEN",
    "MEDIA_R2_ENDPOINT",
  ] as const
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  // Body Cloudflare receives
  async function purgedHosts(origin: string): Promise<unknown[]> {
    process.env.FILES_DIR = filesDir
    process.env.MEDIA_PUBLIC_ORIGIN = origin
    process.env.CLOUDFLARE_ZONE_ID = "zone"
    process.env.CLOUDFLARE_API_TOKEN = "token"
    delete process.env.MEDIA_R2_ENDPOINT
    const bodies: unknown[] = []
    const original = globalThis.fetch
    globalThis.fetch = Object.assign(
      async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return new Response("{}")
      },
      { preconnect: original.preconnect },
    )
    try {
      const id = await takedown(orgA)
      const handle = createTakedownHandler()
      expect(await handle({ orgId: orgA, takedownId: id })).toBe("done")
    } finally {
      globalThis.fetch = original
    }
    return bodies
  }

  test("Given the worker env, when a takedown runs, then dev copies go and both hosts are purged", async () => {
    const local = publicMediaPath(filesDir, HOST, LOCAL)
    const video = publicMediaPath(filesDir, HOST, VIDEO)
    await touch(local)
    await touch(video)
    expect(await purgedHosts("https://media.contoh.id/v")).toEqual([
      { hosts: [HOST, "media.contoh.id"] },
    ])
    expect(await exists(local)).toBe(false)
    expect(await exists(video)).toBe(false)
  })

  test("Given a media origin that is not https, when a takedown runs, then only the campus is purged", async () => {
    for (const origin of ["http://media.contoh.id", "bukan url"]) {
      expect(await purgedHosts(origin)).toEqual([{ hosts: [HOST] }])
    }
  })
})
